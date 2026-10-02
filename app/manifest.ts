import type { MetadataRoute } from "next"

// Manifest de la PWA de LIPgo. Habilita "Instalar / Añadir a pantalla de
// inicio" en escritorio y movil, usando el logo ya cargado en el proyecto
// (public/lipgo-icon.png, 2161x2161 con transparencia). Next.js lo publica
// en /manifest.webmanifest y agrega el <link rel="manifest"> automaticamente.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LIPGO CRM - Gestión Comercial",
    short_name: "LIPGO CRM",
    description: "Prospectos, cotizaciones, pedidos y cartera",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F3EC",
    theme_color: "#0B0B0C",
    icons: [
      { src: "/lipgo-icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/lipgo-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  }
}
