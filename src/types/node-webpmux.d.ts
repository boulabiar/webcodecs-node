/**
 * Type declarations for node-webpmux
 */

declare module 'node-webpmux' {
  export interface WebPFrame {
    width: number;
    height: number;
    x: number;
    y: number;
    delay: number;
    blend: boolean;
    dispose: boolean;
  }

  export interface WebPAnim {
    loopCount: number;
    bgColor: number[];
  }

  export class Image {
    static initLib(): Promise<void>;

    width: number;
    height: number;
    type: number;
    hasAnim: boolean;
    hasAlpha: boolean;
    anim?: WebPAnim;
    frames?: WebPFrame[];

    load(data: Buffer | string): Promise<void>;
    getImageData(): Promise<Buffer>;
    getFrameData(index: number): Promise<Buffer>;
    save(path?: string): Promise<Buffer | void>;
  }

  const WebP: {
    Image: typeof Image;
  };

  export default WebP;
}
