# Contributing

Thank you for your interest in contributing to `retrieval-eval-kit`.

## Principles

- **Offline and Deterministic**: Do not introduce runtime network calls, external API keys, or non-deterministic behavior.
- **Minimal Surface Area**: Rely on the Node.js standard library at runtime.
- **Strict Contract**: Any change to validation bounds or report fields must be documented in `docs/contract.md` and covered by unit and adversarial tests.

## Development Workflow

1. Install dependencies with Node.js `>= 22`:
   ```bash
   npm install
   ```
2. Run the compiler and test suite:
   ```bash
   npm test
   ```
3. Run the deterministic demo:
   ```bash
   npm run demo
   ```

All contributions are licensed under the MIT License.
