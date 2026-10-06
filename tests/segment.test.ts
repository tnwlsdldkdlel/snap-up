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

describe('segmentRGBA', () => {
  beforeEach(() => {
    vi.resetModules();
    from_pretrained.mockReset();
  });

  it('입력 해상도의 1채널 마스크를 돌려주고 모델은 1회만 로드', async () => {
    const tensor = { sigmoid: () => tensor, mul: () => tensor, to: () => tensor };
    from_pretrained.mockResolvedValue(async () => ({ output_image: [tensor] }));
    const { segmentRGBA } = await import('../lib/segment');
    const img = { w: 3, h: 2, data: new Uint8ClampedArray(3 * 2 * 4) };
    const m1 = await segmentRGBA(img);
    await segmentRGBA(img);
    expect(m1.length).toBe(6);
    expect(m1[0]).toBe(200);
    expect(from_pretrained).toHaveBeenCalledTimes(1);
  });

  it('로드 실패 후 다음 호출에서 다시 로드', async () => {
    const tensor = { sigmoid: () => tensor, mul: () => tensor, to: () => tensor };
    from_pretrained.mockRejectedValueOnce(new Error('net')).mockResolvedValue(async () => ({ output_image: [tensor] }));
    const { segmentRGBA } = await import('../lib/segment');
    const img = { w: 1, h: 1, data: new Uint8ClampedArray(4) };
    await expect(segmentRGBA(img)).rejects.toThrow('net');
    await expect(segmentRGBA(img)).resolves.toHaveLength(1);
    expect(from_pretrained).toHaveBeenCalledTimes(2);
  });

  describe('디바이스 선택', () => {
    afterEach(() => vi.unstubAllGlobals());
    const run = async () => {
      const tensor = { sigmoid: () => tensor, mul: () => tensor, to: () => tensor };
      from_pretrained.mockResolvedValue(async () => ({ output_image: [tensor] }));
      const { segmentRGBA } = await import('../lib/segment');
      await segmentRGBA({ w: 1, h: 1, data: new Uint8ClampedArray(4) });
      return from_pretrained.mock.calls[0][1];
    };

    it('어댑터가 있으면 webgpu + fp16', async () => {
      vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
      expect(await run()).toEqual({ device: 'webgpu', dtype: 'fp16' });
    });
    it('어댑터가 null이면 wasm + fp32', async () => {
      vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
      expect(await run()).toEqual({ device: 'wasm', dtype: 'fp32' });
    });
    it('gpu가 없으면 wasm + fp32', async () => {
      vi.stubGlobal('navigator', {});
      expect(await run()).toEqual({ device: 'wasm', dtype: 'fp32' });
    });
  });
});
