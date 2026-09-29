import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Middleware de sesión.
 *
 * HACE DOS COSAS:
 *
 * 1. REFRESCA EL TOKEN. Los de Supabase caducan en una hora. Sin alguien que
 *    los renueve en cada petición, la sesión muere sola mientras el usuario
 *    trabaja: de pronto los módulos dejan de cargar sin explicación. Llamar a
 *    getUser() aquí dispara la renovación y devuelve la cookie actualizada.
 *
 * 2. BLOQUEA SIN SESIÓN. Antes no existía este archivo y toda la protección
 *    era del lado del navegador, que es como no tener ninguna.
 *
 * LO QUE NO HACE: decidir permisos por módulo. Eso sigue en PermissionGuard y,
 * sobre todo, en la validación que hace cada server action. Aquí solo se
 * responde "¿hay sesión?", no "¿puede ver esto?".
 */
export async function middleware(request: NextRequest) {
  // Los cron de Vercel no tienen sesion: se identifican con CRON_SECRET, que
  // valida cada ruta de /api/cron/. Si pasaran por aqui, se redirigirian a
  // /login y nunca correrian.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    return NextResponse.next({ request })
  }

  // Enlace de carga de documentos del prospecto (PRO-05): lo abre alguien que
  // no tiene usuario. La pagina y su ruta validan el token por su cuenta y no
  // exponen nada del CRM.
  if (request.nextUrl.pathname.startsWith("/carga/") || request.nextUrl.pathname.startsWith("/api/publico/")) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Se escriben en los dos sitios: en `request` para que lo que venga
          // después en ESTA petición ya vea el token nuevo, y en `response`
          // para que el navegador se lo quede.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getUser() y no getSession(): getSession lee la cookie sin comprobar que la
  // firma sea válida, así que un token manipulado pasaría el filtro.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const esLogin = request.nextUrl.pathname.startsWith("/login")

  if (!user && !esLogin) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    // Se recuerda a dónde iba para devolverlo ahí tras entrar.
    url.searchParams.set("next", request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Con sesión abierta, /login no tiene sentido: al inicio.
  if (user && esLogin) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.searchParams.delete("next")
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Todo salvo lo que no necesita sesión:
     *  - _next/static y _next/image: archivos ya compilados
     *  - favicon, manifest, iconos e imágenes
     *  - /api/chat: valida la sesión por su cuenta y responde en streaming;
     *    un redirect aquí le cortaría la respuesta a media frase
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/chat|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
}
