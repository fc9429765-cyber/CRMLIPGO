import type React from "react"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import Script from "next/script"
import { AuthProvider } from "@/components/auth-provider"
import { SubmoduloFiltroProvider } from "@/components/submodulo-filtro-context"
import { PwaInstallPrompt } from "@/components/pwa-install-prompt"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const viewport: Viewport = {
  themeColor: "#0f7b6f",
}

export const metadata: Metadata = {
  title: "LIPGO CRM - Gestión Comercial",
  description: "Prospectos, cotizaciones, pedidos y cartera",
  generator: "v0.app",
  applicationName: "LIPGO CRM",
  appleWebApp: {
    capable: true,
    title: "LIPGO CRM",
    statusBarStyle: "default",
  },
  // iOS/Safari necesita el meta legacy `apple-mobile-web-app-capable=yes` para
  // que "Añadir a pantalla de inicio" abra la app en modo standalone (pantalla
  // completa, como app) y no como un simple acceso directo a Safari. Next solo
  // emite el estándar `mobile-web-app-capable`, así que lo agregamos explícito.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={`font-sans antialiased`}>
        {/* Captura temprana del evento de instalacion (puede dispararse antes
            de montar React); el banner PWA lo consume desde window.__lipgoBIP. */}
        <Script id="pwa-bip-capture" strategy="beforeInteractive">
          {`window.__lipgoBIP=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__lipgoBIP=e;window.dispatchEvent(new Event('lipgo-bip'));});`}
        </Script>
        <AuthProvider>
          {/* Filtro año/mes del submódulo compartido con la tira de KPIs del módulo. */}
          <SubmoduloFiltroProvider>{children}</SubmoduloFiltroProvider>
          {/* Necesario para que useToast muestre feedback en toda la app. */}
          <Toaster />
        </AuthProvider>
        {/* Banner "¿Quieres instalar LIPgo?" (PWA) en escritorio y movil. */}
        <PwaInstallPrompt />
        <Analytics />
        <Script
          src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
