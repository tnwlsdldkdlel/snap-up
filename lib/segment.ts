import type { RGBA } from './composite';
import type { Mask } from './mask';

type Device = 'webgpu' | 'wasm';

/**
 * WebGPU: BiRefNet_lite fp16(115MB, 1024px). 경계 품질이 부족하면 'onnx-community/BiRefNet-portrait-ONNX'(fp16 490MB)로 교체.
 * WASM: BiRefNet은 1024px fp32에서 wasm 32비트 메모리(4GB)를 넘겨 bad_alloc이 나므로 인물 매팅용 MODNet(fp32 26MB, 짧은 변 512px)을 쓴다.
 */
export const SEGMENT_MODELS: Record<Device, { id: string; dtype: 'fp16' | 'fp32' }> = {
  webgpu: { id: 'onnx-community/BiRefNet_lite-ONNX', dtype: 'fp16' },
  wasm: { id: 'Xenova/modnet', dtype: 'fp32' },
};

type Loaded = { model: any; processor: any; RawImage: any; device: Device };
export type OnStage = (msg: string) => void;
let loading: Promise<Loaded> | null = null;

/** 단계를 UI(onStage)와 콘솔에 함께 남긴다. 진행률처럼 자주 바뀌는 값은 log=false로 UI에만 */
function stager(onStage?: OnStage) {
  return (msg: string, log = true) => {
    onStage?.(msg);
    if (log) console.info(`[segment] ${msg}`);
  };
}
// GPU 한도 초과 등으로 WebGPU 추론이 실패하면 이후엔 WASM만 쓴다
let webgpuFailed = false;

async function hasWebGPU(): Promise<boolean> {
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter();
    // BiRefNet_lite의 한 셰이더가 storage buffer 17개를 쓴다. 한도 16인 GPU에서는 추론이 실패한다
    return !!adapter && (adapter.limits?.maxStorageBuffersPerShaderStage ?? 0) >= 17;
  } catch {
    return false;
  }
}

function load(stage: ReturnType<typeof stager>): Promise<Loaded> {
  loading ??= (async () => {
    const t0 = performance.now();
    stage('분할 엔진 준비 중');
    const { AutoModel, AutoProcessor, RawImage } = await import('@huggingface/transformers');
    stage('GPU 확인 중');
    const device: Device = !webgpuFailed && (await hasWebGPU()) ? 'webgpu' : 'wasm';
    const { id, dtype } = SEGMENT_MODELS[device];
    stage(`모델 불러오는 중 · ${id} (${device}, ${dtype})`);
    // 첫 사용은 내려받고, 이후엔 브라우저 캐시에서 읽는다. 둘 다 같은 progress 이벤트로 온다
    const files: Record<string, { loaded: number; total: number }> = {};
    let shown = -1;
    const progress_callback = (p: any) => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file] = { loaded: p.loaded, total: p.total };
      const all = Object.values(files);
      const loaded = all.reduce((s, f) => s + f.loaded, 0), total = all.reduce((s, f) => s + f.total, 0);
      const pct = Math.floor((loaded / total) * 100);
      if (pct === shown) return;
      shown = pct;
      stage(`모델 불러오는 중 · ${pct}% (${(loaded / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)}MB)`, pct % 25 === 0);
    };
    const model = await AutoModel.from_pretrained(id, { device, dtype, progress_callback });
    const processor = await AutoProcessor.from_pretrained(id);
    stage(`모델 준비 완료 · ${device} · ${Math.round(performance.now() - t0)}ms`);
    return { model, processor, RawImage, device };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** 인물 alpha(입력 해상도, 1채널, 인물=255) */
export async function segmentRGBA(img: RGBA, onStage?: OnStage): Promise<Mask> {
  const stage = stager(onStage);
  const loaded = await load(stage);
  try {
    return await run(loaded, img, stage);
  } catch (e) {
    if (loaded.device !== 'webgpu') throw e;
    console.warn('[segment] WebGPU 추론 실패, WASM으로 재시도', e);
    webgpuFailed = true;
    loading = null;
    loaded.model.dispose?.()?.catch?.(() => {});
    return run(await load(stage), img, stage);
  }
}

async function run({ model, processor, RawImage, device }: Loaded, img: RGBA, stage: ReturnType<typeof stager>): Promise<Mask> {
  const t0 = performance.now();
  stage(`인물 인식 중 · ${device} · ${img.w}×${img.h}`);
  const { pixel_values } = await processor(new RawImage(img.data, img.w, img.h, 4).rgb());
  // 모델마다 입출력 이름이 달라(BiRefNet: input_image/output_image, MODNet: input/output) 세션에서 읽는다
  const { inputNames, outputNames } = model.sessions.model;
  const out = (await model({ [inputNames[0]]: pixel_values }))[outputNames[0]][0];
  // BiRefNet은 logit, MODNet은 0~1 alpha를 낸다
  const alpha = out.data.some((x: number) => x < 0 || x > 1) ? out.sigmoid() : out;
  const mask = await RawImage.fromTensor(alpha.mul(255).to('uint8')).resize(img.w, img.h);
  stage(`인물 인식 완료 · ${Math.round(performance.now() - t0)}ms`);
  return new Uint8Array(mask.data);
}
