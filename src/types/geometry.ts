/**
 * Geometry types - DOMRect and related structures
 */

/**
 * DOMRectInit - initialization object for DOMRect
 */
export interface DOMRectInit {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * DOMRectReadOnly - immutable rectangle representation
 */
export class DOMRectReadOnly {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  get top(): number {
    return this.y;
  }

  get right(): number {
    return this.x + this.width;
  }

  get bottom(): number {
    return this.y + this.height;
  }

  get left(): number {
    return this.x;
  }

  toJSON(): DOMRectInit {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}

/**
 * PlaneLayout - describes the layout of a single plane in a video frame
 */
export interface PlaneLayout {
  offset: number;
  stride: number;
}
