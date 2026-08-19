/**
 * A tabela de teclado da UX-SPEC §9.2, em um lugar só.
 *
 * Duas regras que este módulo existe para garantir:
 * - **nunca `cmd`** — no Windows um atalho com `cmd` é silenciosamente ignorado
 *   (pesquisa 07 §8.1); aqui só entram `ctrl`, `shift` e `alt`;
 * - **um significado, um atalho** em toda a extensão (§9.1). Quem precisar de
 *   "Copiar detalhes técnicos" em outra tela importa `SHORTCUTS.copyTechnical`,
 *   em vez de redigitar `{ modifiers: ["ctrl", "alt"], key: "c" }` e divergir.
 *
 * `Keyboard.Shortcut.Common.*` é preferido onde existe equivalente semântico, porque o
 * próprio Raycast já traduz esses para as teclas do Windows (07 §8.4): `Common.Copy` é
 * `Ctrl+Shift+C`, `Common.New` é `Ctrl+N`, `Common.Open` é `Ctrl+O`, `Common.Refresh` é
 * `Ctrl+R`, `Common.Edit` é `Ctrl+E`, `Common.CopyPath` é `Alt+Shift+C`.
 *
 * Atalho aqui é **acelerador**: toda ação também está no `ActionPanel` (`Ctrl+K`).
 */

import { Keyboard } from "@raycast/api";

export const SHORTCUTS = {
  /** `Copiar resposta` / `Copiar comando` / `Copiar o que já veio`. */
  copy: Keyboard.Shortcut.Common.Copy,
  /** `Colar no aplicativo ativo`. */
  paste: { modifiers: ["ctrl", "shift"], key: "v" },
  /** `Continuar esta conversa`. */
  continueConversation: { modifiers: ["ctrl", "shift"], key: "return" },
  /** `Nova conversa` / `Perguntar de novo`. */
  newConversation: Keyboard.Shortcut.Common.New,
  /** `Abrir no Hermes Desktop`. */
  openInDesktop: Keyboard.Shortcut.Common.Open,
  /** `Parar`. */
  stop: { modifiers: ["ctrl", "shift"], key: "p" },
  /** `Orientar execução`. */
  steer: { modifiers: ["ctrl", "shift"], key: "g" },
  /** `Ver etapas` / `Ver resposta`. */
  toggleSteps: { modifiers: ["ctrl"], key: "t" },
  /** `Mostrar detalhes técnicos`. */
  showTechnical: { modifiers: ["ctrl", "shift"], key: "i" },
  /** `Copiar detalhes técnicos`. */
  copyTechnical: { modifiers: ["ctrl", "alt"], key: "c" },
  /** `Atualizar` / `Tentar novamente`. */
  refresh: Keyboard.Shortcut.Common.Refresh,
  /** `Abrir configurações`. */
  preferences: { modifiers: ["ctrl", "shift"], key: "a" },
  /** `Testar de novo` / `Testar conexão`. */
  testConnection: { modifiers: ["ctrl", "shift"], key: "t" },
  /** `Detectar configuração automaticamente`. */
  autoDetect: { modifiers: ["ctrl", "shift"], key: "d" },
  /** `Excluir conversa` / `Remover da lista` / `Esquecer a chave detectada`. */
  remove: Keyboard.Shortcut.Common.Remove,
  /** `Abrir a pasta do Hermes`. */
  hermesFolder: { modifiers: ["ctrl", "shift"], key: "f" },
  /** `Copiar o caminho do arquivo` — o caminho, nunca o conteúdo. */
  copyPath: Keyboard.Shortcut.Common.CopyPath,
  /** `Renomear conversa`. */
  rename: Keyboard.Shortcut.Common.Edit,
  /** `Ramificar conversa`. */
  branch: { modifiers: ["ctrl", "shift"], key: "b" },
  /** `Usar só na próxima pergunta` — §2.6. `Usar como modelo padrão` é o `Enter` da lista. */
  nextTurnModel: { modifiers: ["ctrl", "shift"], key: "m" },
  /** `Ver tarefas em andamento`. */
  activeRuns: { modifiers: ["ctrl", "shift"], key: "e" },
  /** `Negar` (aprovação). */
  deny: { modifiers: ["ctrl", "shift"], key: "n" },
  /** `Aprovar durante esta execução`. */
  approveSession: { modifiers: ["alt", "shift"], key: "e" },
  /** `Aprovar sempre este tipo de comando` — ação destrutiva. */
  approveAlways: { modifiers: ["alt", "shift"], key: "s" },
  /** `Fixar conversa` / `Desafixar conversa` — `Common.Pin` é `Ctrl+.` no Windows. */
  pin: Keyboard.Shortcut.Common.Pin,
  /** `Arquivar conversa` / `Desarquivar conversa`. */
  archive: { modifiers: ["alt"], key: "a" },
  /**
   * `Carregar parte anterior da conversa` — significado novo, atalho novo (§9.1).
   * Não colide com nada da tabela §9.2 nem com o que o Raycast reserva.
   */
  loadOlder: { modifiers: ["ctrl", "shift"], key: "h" },
} satisfies Record<string, Keyboard.Shortcut>;
