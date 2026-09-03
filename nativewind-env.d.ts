/// <reference types="nativewind/types" />

// TypeScript 6 (SDK 56 onwards) rejects a side-effect import of a file it has
// no declaration for with TS2882, which breaks `import "../../global.css"` in
// src/app/_layout.tsx. NativeWind's own types only augment "react-native" and
// "@react-native/virtualized-lists" (react-native-css-interop/types.d.ts), so
// the stylesheet declaration has to live here.
declare module "*.css";
