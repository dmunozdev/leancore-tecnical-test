import type { Role } from '../contract';

export function RoleSelect({ onSelect }: { onSelect: (role: Role) => void }) {
  return (
    <main className="role-select">
      <h1>Chat de soporte</h1>
      <p>¿Cómo quieres entrar?</p>
      <div className="role-select__buttons">
        <button type="button" onClick={() => onSelect('cliente')}>
          Entrar como cliente
        </button>
        <button type="button" onClick={() => onSelect('agente')}>
          Entrar como agente
        </button>
      </div>
    </main>
  );
}
