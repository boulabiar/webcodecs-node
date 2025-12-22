/**
 * HDR Metadata tests
 */

import {
  VideoColorSpace,
  createHdr10MasteringMetadata,
  createContentLightLevel,
  HDR10_DISPLAY_PRIMARIES,
} from '../formats/color-space.js';
import type {
  HdrMetadata,
  SmpteSt2086Metadata,
  ContentLightLevelInfo,
} from '../formats/color-space.js';

describe('HDR Metadata', () => {
  describe('VideoColorSpace with HDR', () => {
    it('should detect HDR content with PQ transfer', () => {
      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'pq',
        matrix: 'bt2020-ncl',
        fullRange: false,
      });

      expect(colorSpace.isHdr).toBe(true);
    });

    it('should detect HDR content with HLG transfer', () => {
      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'hlg',
        matrix: 'bt2020-ncl',
        fullRange: false,
      });

      expect(colorSpace.isHdr).toBe(true);
    });

    it('should detect SDR content', () => {
      const colorSpace = new VideoColorSpace({
        primaries: 'bt709',
        transfer: 'bt709',
        matrix: 'bt709',
        fullRange: false,
      });

      expect(colorSpace.isHdr).toBe(false);
    });

    it('should store and retrieve HDR metadata', () => {
      const hdrMetadata: HdrMetadata = {
        smpteSt2086: createHdr10MasteringMetadata(1000),
        contentLightLevel: createContentLightLevel(800, 400),
      };

      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'pq',
        matrix: 'bt2020-ncl',
        fullRange: false,
        hdrMetadata,
      });

      expect(colorSpace.hasHdrMetadata).toBe(true);
      expect(colorSpace.hdrMetadata).not.toBeNull();
      expect(colorSpace.hdrMetadata?.smpteSt2086?.maxLuminance).toBe(1000);
      expect(colorSpace.hdrMetadata?.contentLightLevel?.maxCLL).toBe(800);
      expect(colorSpace.hdrMetadata?.contentLightLevel?.maxFALL).toBe(400);
    });

    it('should handle missing HDR metadata', () => {
      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'pq',
      });

      expect(colorSpace.isHdr).toBe(true);
      expect(colorSpace.hasHdrMetadata).toBe(false);
      expect(colorSpace.hdrMetadata).toBeNull();
    });

    it('should serialize HDR metadata in toJSON', () => {
      const hdrMetadata: HdrMetadata = {
        smpteSt2086: createHdr10MasteringMetadata(4000, 0.001),
        contentLightLevel: createContentLightLevel(2000, 1000),
      };

      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'pq',
        matrix: 'bt2020-ncl',
        fullRange: false,
        hdrMetadata,
      });

      const json = colorSpace.toJSON();

      expect(json.primaries).toBe('bt2020');
      expect(json.transfer).toBe('pq');
      expect(json.hdrMetadata).toBeDefined();
      expect(json.hdrMetadata?.smpteSt2086?.maxLuminance).toBe(4000);
      expect(json.hdrMetadata?.smpteSt2086?.minLuminance).toBe(0.001);
    });
  });

  describe('HDR10_DISPLAY_PRIMARIES', () => {
    it('should have BT.2020 primaries', () => {
      expect(HDR10_DISPLAY_PRIMARIES.primaryRChromaticityX).toBeCloseTo(0.708, 3);
      expect(HDR10_DISPLAY_PRIMARIES.primaryRChromaticityY).toBeCloseTo(0.292, 3);
      expect(HDR10_DISPLAY_PRIMARIES.primaryGChromaticityX).toBeCloseTo(0.170, 3);
      expect(HDR10_DISPLAY_PRIMARIES.primaryGChromaticityY).toBeCloseTo(0.797, 3);
      expect(HDR10_DISPLAY_PRIMARIES.primaryBChromaticityX).toBeCloseTo(0.131, 3);
      expect(HDR10_DISPLAY_PRIMARIES.primaryBChromaticityY).toBeCloseTo(0.046, 3);
    });

    it('should have D65 white point', () => {
      expect(HDR10_DISPLAY_PRIMARIES.whitePointChromaticityX).toBeCloseTo(0.3127, 4);
      expect(HDR10_DISPLAY_PRIMARIES.whitePointChromaticityY).toBeCloseTo(0.3290, 4);
    });
  });

  describe('createHdr10MasteringMetadata', () => {
    it('should create metadata with default min luminance', () => {
      const metadata = createHdr10MasteringMetadata(1000);

      expect(metadata.maxLuminance).toBe(1000);
      expect(metadata.minLuminance).toBe(0.0001);
      expect(metadata.primaryRChromaticityX).toBe(HDR10_DISPLAY_PRIMARIES.primaryRChromaticityX);
    });

    it('should create metadata with custom min luminance', () => {
      const metadata = createHdr10MasteringMetadata(4000, 0.005);

      expect(metadata.maxLuminance).toBe(4000);
      expect(metadata.minLuminance).toBe(0.005);
    });
  });

  describe('createContentLightLevel', () => {
    it('should create content light level info', () => {
      const cll = createContentLightLevel(1500, 800);

      expect(cll.maxCLL).toBe(1500);
      expect(cll.maxFALL).toBe(800);
    });
  });

  describe('SMPTE ST 2086 Metadata', () => {
    it('should support full mastering display metadata', () => {
      const smpteSt2086: SmpteSt2086Metadata = {
        // Sony BVM-X300 reference monitor primaries
        primaryRChromaticityX: 0.680,
        primaryRChromaticityY: 0.320,
        primaryGChromaticityX: 0.265,
        primaryGChromaticityY: 0.690,
        primaryBChromaticityX: 0.150,
        primaryBChromaticityY: 0.060,
        whitePointChromaticityX: 0.3127,
        whitePointChromaticityY: 0.3290,
        maxLuminance: 1000,
        minLuminance: 0.0005,
      };

      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'pq',
        hdrMetadata: { smpteSt2086 },
      });

      expect(colorSpace.hasHdrMetadata).toBe(true);
      expect(colorSpace.hdrMetadata?.smpteSt2086).toBeDefined();
      expect(colorSpace.hdrMetadata?.contentLightLevel).toBeUndefined();
    });
  });

  describe('Content Light Level Only', () => {
    it('should support content light level without mastering metadata', () => {
      const contentLightLevel: ContentLightLevelInfo = {
        maxCLL: 800,
        maxFALL: 400,
      };

      const colorSpace = new VideoColorSpace({
        primaries: 'bt2020',
        transfer: 'hlg',
        hdrMetadata: { contentLightLevel },
      });

      expect(colorSpace.hasHdrMetadata).toBe(true);
      expect(colorSpace.hdrMetadata?.smpteSt2086).toBeUndefined();
      expect(colorSpace.hdrMetadata?.contentLightLevel?.maxCLL).toBe(800);
    });
  });
});
