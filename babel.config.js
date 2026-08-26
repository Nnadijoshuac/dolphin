const path = require("node:path");

const expoPackageRoot = path.dirname(require.resolve("expo/package.json"));
const babelPresetExpo = require.resolve("babel-preset-expo", {
  paths: [expoPackageRoot],
});

module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: [
      [
        babelPresetExpo,
        {
          jsxImportSource: "nativewind",
          // Reown's ESM bundles use import.meta; Expo's Babel preset must lower it for native.
          unstable_transformImportMeta: true,
        },
      ],
      "nativewind/babel",
    ],
  };
};
