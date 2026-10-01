import { defineConfig } from "vitest/config"

// Pruebas de la logica pura del CRM: aplicacion de pagos, sobrecupo, maquinas
// de estado, reglas de integracion (RNF-07). No tocan la base ni la red: lo
// que depende de I/O se prueba en el recorrido manual de cada fase.
export default defineConfig({
  // Resuelve el alias "@/..." desde tsconfig.json, igual que Next.
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
})
