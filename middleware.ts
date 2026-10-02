import { NextResponse, type NextRequest } from "next/server"
import { COOKIE_SESION, verificarSesion } from "@/lib/crm-token"

/**
 * Middleware de sesion del CRM.
 *
 * El CRM tiene USUARIOS PROPIOS (scripts/209_crm_usuarios.sql): ya no usa el
 * Supabase Auth de LIPgo, asi que una sesion o un usuario de LIPgo no sirven
 * aqui. La sesion es la cookie `crm_sesion`, firmada con CRM_AUTH_SECRET.
 *
 * HACE TRES COSAS:
 *   1. Sin sesion valida: las paginas van a /login y las API responden 401.
 *   2. Con clave temporal pendiente de cambio: solo se deja ver
 *      /cambiar-clave (y sus rutas); todo lo demas lleva alli.
 *   3. Con sesion abierta, /login lleva al inicio.
 *
 * LO QUE NO HACE: decidir si la sesion sigue vigente en la base (revocada,
 * usuario desactivado) ni permisos por modulo. Aqui no hay base de datos:
 * eso lo hace lib/crm-sesion.ts en cada accion del servidor.
 */

const LIBRES = [
  "/api/cron/", // Vercel cron: se identifican con CRON_SECRET en cada ruta
  "/carga/", // enlace publico de documentos del prospecto (PRO-05)
  "/api/publico/",
  "/api/crm-auth/login",
  "/api/crm-auth/logout",
]

export async function middleware(request: NextRequest) {
  const ruta = request.nextUrl.pathname
  if (LIBRES.some((p) => ruta.startsWith(p))) return NextResponse.next({ request })

  const claims = await verificarSesion(request.cookies.get(COOKIE_SESION)?.value)
  const esApi = ruta.startsWith("/api/")
  const esLogin = ruta.startsWith("/login")
  const esCambioClave = ruta.startsWith("/cambiar-clave") || ruta.startsWith("/api/crm-auth/")

  if (!claims) {
    if (esLogin) return NextResponse.next({ request })
    if (esApi) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    // Se recuerda a donde iba para devolverlo ahi tras entrar.
    if (ruta !== "/") url.searchParams.set("next", ruta)
    return NextResponse.redirect(url)
  }

  if (claims.dcc && !esCambioClave) {
    if (esApi) return NextResponse.json({ error: "Debes cambiar tu contraseña temporal." }, { status: 403 })
    const url = request.nextUrl.clone()
    url.pathname = "/cambiar-clave"
    url.search = ""
    return NextResponse.redirect(url)
  }

  if (esLogin) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    /*
     * Todo salvo lo que no necesita sesion:
     *  - _next/static y _next/image: archivos ya compilados
     *  - favicon, manifest, sw.js, iconos e imagenes
     *  - /api/chat: valida la sesion por su cuenta y responde en streaming;
     *    un redirect aqui le cortaria la respuesta a media frase
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|api/chat|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
}
