# Maany SDK Monorepo

Monorepo for the Maany MPC SDK, including React Native coordinators and UI packages.

## Packages

- `@maany/mpc-coordinator-rn` – headless coordinator utilities for React Native
- `@maany/react-native-ui` – lightweight provider, hooks, and demo components
- Platform placeholders for web, iOS, and Android coordinators

## Examples

- `rn-wallet-app` – sample wallet using the shared UI package
- `headless-rn` – minimal app integrating the coordinator directly

## Scripts

Run repo tasks with pnpm:

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm release
```
