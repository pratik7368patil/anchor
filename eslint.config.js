export default [
  {
    ignores: ["dist/**", "node_modules/**", ".anchor/**"],
  },
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
