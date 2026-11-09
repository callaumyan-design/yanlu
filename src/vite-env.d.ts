/// <reference types="vite/client" />

declare module "clipper-lib" {
  interface ClipperOffset {
    AddPath(
      path: { X: number; Y: number }[],
      joinType: number,
      endType: number,
    ): void;
    Execute(solution: { X: number; Y: number }[][], delta: number): void;
  }
  interface ClipperLibStatic {
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: {
      etOpenSquare: number;
      etOpenRound: number;
      etOpenButt: number;
      etClosedLine: number;
      etClosedPolygon: number;
    };
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => ClipperOffset;
  }
  const ClipperLib: ClipperLibStatic;
  export default ClipperLib;
}
