/**
 * Common type definitions for WebCodecs API
 * These types mirror the browser DOM types needed for WebCodecs
 */

// BufferSource is a union type that represents binary data
export type BufferSource = ArrayBuffer | ArrayBufferView;

/**
 * DOMException polyfill for Node.js
 */
export class DOMException extends Error {
  readonly code: number;
  readonly name: string;

  // Standard DOMException error codes
  static readonly INDEX_SIZE_ERR = 1;
  static readonly DOMSTRING_SIZE_ERR = 2;
  static readonly HIERARCHY_REQUEST_ERR = 3;
  static readonly WRONG_DOCUMENT_ERR = 4;
  static readonly INVALID_CHARACTER_ERR = 5;
  static readonly NO_DATA_ALLOWED_ERR = 6;
  static readonly NO_MODIFICATION_ALLOWED_ERR = 7;
  static readonly NOT_FOUND_ERR = 8;
  static readonly NOT_SUPPORTED_ERR = 9;
  static readonly INUSE_ATTRIBUTE_ERR = 10;
  static readonly INVALID_STATE_ERR = 11;
  static readonly SYNTAX_ERR = 12;
  static readonly INVALID_MODIFICATION_ERR = 13;
  static readonly NAMESPACE_ERR = 14;
  static readonly INVALID_ACCESS_ERR = 15;
  static readonly VALIDATION_ERR = 16;
  static readonly TYPE_MISMATCH_ERR = 17;
  static readonly SECURITY_ERR = 18;
  static readonly NETWORK_ERR = 19;
  static readonly ABORT_ERR = 20;
  static readonly URL_MISMATCH_ERR = 21;
  static readonly QUOTA_EXCEEDED_ERR = 22;
  static readonly TIMEOUT_ERR = 23;
  static readonly INVALID_NODE_TYPE_ERR = 24;
  static readonly DATA_CLONE_ERR = 25;

  constructor(message?: string, name?: string) {
    super(message);
    this.name = name || 'Error';
    this.code = this._getCode(this.name);
  }

  private _getCode(name: string): number {
    const codeMap: Record<string, number> = {
      IndexSizeError: 1,
      HierarchyRequestError: 3,
      WrongDocumentError: 4,
      InvalidCharacterError: 5,
      NoModificationAllowedError: 7,
      NotFoundError: 8,
      NotSupportedError: 9,
      InUseAttributeError: 10,
      InvalidStateError: 11,
      SyntaxError: 12,
      InvalidModificationError: 13,
      NamespaceError: 14,
      InvalidAccessError: 15,
      TypeMismatchError: 17,
      SecurityError: 18,
      NetworkError: 19,
      AbortError: 20,
      URLMismatchError: 21,
      QuotaExceededError: 22,
      TimeoutError: 23,
      InvalidNodeTypeError: 24,
      DataCloneError: 25,
    };
    return codeMap[name] || 0;
  }
}

/**
 * Codec state values
 */
export type CodecState = 'unconfigured' | 'configured' | 'closed';

/**
 * Hardware acceleration preference
 */
export type HardwareAcceleration = 'no-preference' | 'prefer-hardware' | 'prefer-software';

/**
 * Alpha handling mode
 */
export type AlphaOption = 'discard' | 'keep';

/**
 * Latency mode for encoding
 */
export type LatencyMode = 'quality' | 'realtime';

/**
 * Bitrate mode for encoding
 */
export type BitrateMode = 'constant' | 'variable' | 'quantizer';

/**
 * AVC (H.264) format options
 */
export type AvcBitstreamFormat = 'annexb' | 'avc';

/**
 * HEVC (H.265) format options
 */
export type HevcBitstreamFormat = 'annexb' | 'hevc';
