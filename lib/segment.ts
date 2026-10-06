import type { RGBA } from './composite';
import type { Mask } from './mask';

/** 115MB(fp16). 품질이 부족하면 'onnx-community/BiRefNet-portrait-ONNX'(fp16 490MB)로 교체 */
export const SEGMENT_MODEL = 'onnx-community/BiRefNet_lite-ONNX';

type Loaded = { model: any; processor: any; RawImage: any };
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const { AutoModel, AutoProcessor, RawImage } = await import('@huggingface/transformers');
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
    const model = await AutoModel.from_pretrained(SEGMENT_MODEL, { device, dtype: 'fp16' });
    const processor = await AutoProcessor.from_pretrained(SEGMENT_MODEL);
    return { model, processor, RawImage };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** 인물 alpha(입력 해상도, 1채널, 인물=255) */
export async function segmentRGBA(img: RGBA): Promise<Mask> {
  const { model, processor, RawImage } = await load();
  const { pixel_values } = await processor(new RawImage(img.data, img.w, img.h, 4).rgb());
  const { output_image } = await model({ input_image: pixel_values });
  const mask = await RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(img.w, img.h);
  return new Uint8Array(mask.data);
}
