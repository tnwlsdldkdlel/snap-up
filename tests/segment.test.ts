import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const from_pretrained = vi.fn();
vi.mock('@huggingface/transformers', () => {
  class RawImage {
    constructor(public data: Uint8Array | Uint8ClampedArray, public width: number, public height: number, public channels: number) {}
    rgb() { return this; }
    async resize(w: number, h: number) { return new RawImage(new Uint8Array(w * h).fill(200), w, h, 1); }
    static fromTensor() { return new RawImage(new Uint8Array(4), 2, 2, 1); }
  }
  return {
    RawImage,
    AutoModel: { from_pretrained: (...a: unknown[]) => from_pretrained(...a) },
    AutoProcessor: { from_pretrained: async () => async () => ({ pixel_values: {} }) },
  };
});

function fakeTensor(data: number[] = [0.5]) {
  const t = { data, sigmoid: vi.fn(() => t), mul: () => t, to: () => t };
  return t;
}

/** 세션의 입출력 이름을 따르는 가짜 모델. 입력 이름이 틀리면 실패한다 */
function fakeModel(tensor = fakeTensor(), names = { input: 'input', output: 'output' }) {
  const model = async (inputs: Record<string, unknown>) => {
    if (!(names.input in inputs)) throw new Error(`missing input ${names.input}`);
    return { [names.output]: [tensor] };
  };
  return Object.assign(model, { sessions: { model: { inputNames: [names.input], outputNames: [names.output] } }, dispose: vi.fn(async () => {}) });
}

const img1 = () => ({ w: 1, h: 1, data: new Uint8ClampedArray(4) });

describe('segmentRGBA', () => {
  beforeEach(() => {
    vi.resetModules();
    from_pretrained.mockReset();
  });

  it('입력 해상도의 1채널 마스크를 돌려주고 모델은 1회만 로드', async () => {
    from_pretrained.mockResolvedValue(fakeModel());
    const { segmentRGBA } = await import('../lib/segment');
    const img = { w: 3, h: 2, data: new Uint8ClampedArray(3 * 2 * 4) };
    const m1 = await segmentRGBA(img);
    await segmentRGBA(img);
    expect(m1.length).toBe(6);
    expect(m1[0]).toBe(200);
    expect(from_pretrained).toHaveBeenCalledTimes(1);
  });

  it('로드 실패 후 다음 호출에서 다시 로드', async () => {
    from_pretrained.mockRejectedValueOnce(new Error('net')).mockResolvedValue(fakeModel());
    const { segmentRGBA } = await import('../lib/segment');
    await expect(segmentRGBA(img1())).rejects.toThrow('net');
    await expect(segmentRGBA(img1())).resolves.toHaveLength(1);
    expect(from_pretrained).toHaveBeenCalledTimes(2);
  });

  it('세션의 입출력 이름을 쓰고, 0~1 밖의 logit일 때만 sigmoid', async () => {
    const logit = fakeTensor([-3, 4]);
    const alpha = fakeTensor([0, 1]);
    from_pretrained.mockResolvedValueOnce(fakeModel(logit, { input: 'input_image', output: 'output_image' }));
    let { segmentRGBA } = await import('../lib/segment');
    await expect(segmentRGBA(img1())).resolves.toHaveLength(1);
    expect(logit.sigmoid).toHaveBeenCalled();

    vi.resetModules();
    from_pretrained.mockResolvedValueOnce(fakeModel(alpha));
    ({ segmentRGBA } = await import('../lib/segment'));
    await expect(segmentRGBA(img1())).resolves.toHaveLength(1);
    expect(alpha.sigmoid).not.toHaveBeenCalled();
  });

  it('로드 진행률과 단계를 onStage로 알리고, 진행률은 25% 단위로만 콘솔에 남긴다', async () => {
    from_pretrained.mockImplementation(async (_id: string, opts: { progress_callback: (p: object) => void }) => {
      for (const loaded of [0, 10, 50, 100]) opts.progress_callback({ status: 'progress', file: 'onnx/model.onnx', loaded, total: 100 });
      return fakeModel();
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const stages: string[] = [];
    const { segmentRGBA } = await import('../lib/segment');
    await segmentRGBA(img1(), (s) => stages.push(s));
    expect(stages.filter((s) => s.includes('%'))).toEqual([
      '모델 불러오는 중 · 0% (0/0MB)', '모델 불러오는 중 · 10% (0/0MB)', '모델 불러오는 중 · 50% (0/0MB)', '모델 불러오는 중 · 100% (0/0MB)',
    ]);
    expect(stages.at(-1)).toMatch(/^인물 인식 완료/);
    const logged = info.mock.calls.map((c) => String(c[0]));
    expect(logged.filter((s) => s.includes('%'))).toHaveLength(3);
    info.mockRestore();
  });

  describe('디바이스 선택', () => {
    afterEach(() => vi.unstubAllGlobals());
    const gpu = (limit: number) => ({ gpu: { requestAdapter: async () => ({ limits: { maxStorageBuffersPerShaderStage: limit } }) } });
    const run = async () => {
      from_pretrained.mockResolvedValue(fakeModel());
      const { segmentRGBA } = await import('../lib/segment');
      await segmentRGBA(img1());
      return from_pretrained.mock.calls[0];
    };
    const WEBGPU = ['onnx-community/BiRefNet_lite-ONNX', expect.objectContaining({ device: 'webgpu', dtype: 'fp16' })];
    const WASM = ['Xenova/modnet', expect.objectContaining({ device: 'wasm', dtype: 'fp32' })];

    it('storage buffer 한도가 17 이상이면 BiRefNet webgpu fp16', async () => {
      vi.stubGlobal('navigator', gpu(17));
      expect(await run()).toEqual(WEBGPU);
    });
    it('한도가 16이면 처음부터 MODNet wasm fp32', async () => {
      vi.stubGlobal('navigator', gpu(16));
      expect(await run()).toEqual(WASM);
    });
    it('어댑터가 null이면 wasm', async () => {
      vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
      expect(await run()).toEqual(WASM);
    });
    it('gpu가 없으면 wasm', async () => {
      vi.stubGlobal('navigator', {});
      expect(await run()).toEqual(WASM);
    });
    it('webgpu 추론이 실패하면 wasm 모델로 다시 로드해 재시도하고, 이후엔 wasm만 쓴다', async () => {
      vi.stubGlobal('navigator', gpu(17));
      const gpuModel = Object.assign(fakeModel(), { sessions: { model: { inputNames: ['x'], outputNames: ['y'] } } });
      const failing = Object.assign(async () => { throw new Error('Too many storage buffers in shader'); }, gpuModel);
      from_pretrained.mockResolvedValueOnce(failing).mockResolvedValue(fakeModel());
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { segmentRGBA } = await import('../lib/segment');
      await expect(segmentRGBA(img1())).resolves.toHaveLength(1);
      await segmentRGBA(img1());
      expect(from_pretrained.mock.calls).toEqual([WEBGPU, WASM]);
      expect(failing.dispose).toHaveBeenCalled();
    });
    it('wasm 추론 실패는 재시도 없이 그대로 던진다', async () => {
      vi.stubGlobal('navigator', {});
      from_pretrained.mockResolvedValue(Object.assign(async () => { throw new Error('oom'); }, fakeModel()));
      const { segmentRGBA } = await import('../lib/segment');
      await expect(segmentRGBA(img1())).rejects.toThrow('oom');
      expect(from_pretrained).toHaveBeenCalledTimes(1);
    });
  });
});
