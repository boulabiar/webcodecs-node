/**
 * Frame parsers for different container formats
 */

// IVF parser (VP8, VP9, AV1)
export {
  IVF_HEADER_SIZE,
  IVF_FRAME_HEADER_SIZE,
  IVF_SIGNATURE,
  createIvfParserState,
  validateIvfSignature,
  parseIvfFrames,
  isVP9KeyFrame,
  isVP8KeyFrame,
  isAV1KeyFrame,
  type IvfParserState,
} from './ivf.js';

// Annex B parser (H.264, HEVC)
export {
  H264_NAL_TYPES,
  HEVC_NAL_TYPES,
  createAnnexBParserState,
  getNalType,
  isAudNal,
  findStartCode,
  findAudPositions,
  isH264KeyFrame,
  isHEVCKeyFrame,
  isKeyFrame,
  parseAnnexBFrames,
  flushAnnexBParser,
  type AnnexBParserState,
} from './annexb.js';
