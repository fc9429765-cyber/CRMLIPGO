// Tipos compartidos para la administracion de usuarios. Viven fuera de
// `user-admin-actions.ts` porque ese archivo tiene la directiva "use server"
// y Next.js prohibe exportar valores/interfaces no-async desde modulos server.

export interface CrearUsuarioInput {
  email: string
  password: string
  usuario: string
  empresaId: number
  // Empresas adicionales de acceso (ademas de la empresa por defecto).
  empresasAdicionales?: number[]
  // Owners a los que tendra acceso (por nombre, como en perfil_acceso_owners).
  owners?: string[]
}

export interface AuthMetaUsuario {
  email: string | null
  last_sign_in_at: string | null
  created_at: string | null
  activo?: boolean
  /** Tiene una clave temporal sin cambiar. */
  debe_cambiar_clave?: boolean
}
