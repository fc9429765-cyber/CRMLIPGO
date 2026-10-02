"use client"

// Banda de bienvenida del Inicio, calcada de la de LIPgo.
//
// Es lo primero que se ve al entrar y es lo que hace que las dos aplicaciones
// se reconozcan como la misma casa: el mismo azul profundo con los dos halos
// de color, el mismo saludo por hora del día, la misma línea de fecha y
// empresa debajo.
//
// EL DETALLE QUE IMPORTA: el saludo se calcula en un efecto, no al renderizar.
// La hora del servidor y la del navegador no tienen por qué coincidir, y si se
// calcula durante el render React encuentra un texto distinto al hidratar y
// tira un error de hidratación en consola. Por eso arranca en "Hola" y se
// concreta en cuanto el componente vive en el navegador.

import { useEffect, useState } from "react"

export function SaludoHero({
  nombre,
  empresa,
}: {
  /** Nombre de pila. Si no hay, el saludo va sin nombre y ya. */
  nombre?: string
  empresa?: string
}) {
  const [info, setInfo] = useState<{ saludo: string; fecha: string }>({
    saludo: "Hola",
    fecha: "",
  })

  useEffect(() => {
    const d = new Date()
    const h = d.getHours()
    const saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"
    const f = d.toLocaleDateString("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "America/Bogota",
    })
    setInfo({ saludo, fecha: f.charAt(0).toUpperCase() + f.slice(1) })
  }, [])

  const primerNombre = (nombre || "").trim().split(" ")[0]

  return (
    <>
      <style>{`
        .crm-home-hero{
          position:relative; overflow:hidden; border-radius:18px; color:#eafaf6;
          background:
            radial-gradient(80% 130% at 92% -20%, rgba(47,212,182,.30), transparent 55%),
            radial-gradient(70% 120% at -5% 120%, rgba(20,140,120,.32), transparent 55%),
            linear-gradient(120deg,#06332e,#0a4a42 55%,#0f6b60);
          border:1px solid rgba(120,230,200,.15);
        }
      `}</style>

      <div className="crm-home-hero px-4 py-2.5">
        <div className="relative z-10 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h1 className="text-base font-extrabold tracking-tight sm:text-lg">
            <span aria-hidden="true">👋</span> {info.saludo}
            {primerNombre ? `, ${primerNombre}` : ""}
          </h1>
          <span className="text-xs sm:text-sm" style={{ color: "#9fe0d3" }}>
            {info.fecha}
            {empresa ? ` · ${empresa}` : ""}
          </span>
        </div>
      </div>
    </>
  )
}

export default SaludoHero
