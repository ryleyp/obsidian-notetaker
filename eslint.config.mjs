import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [".next/**", "out/**", "build/**", "coverage/**", "node_modules/**"],
  },
  ...nextVitals,
  {
    rules: {
      // Catches a variable used outside the scope that declares it, which
      // otherwise only surfaces as a ReferenceError at runtime.
      "no-undef": "error",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
];

export default config;
