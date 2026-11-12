import { CellState } from '../state/machines';

export type CommandId =
  | 'cell.enterEdit'
  | 'cell.runAndStay'
  | 'cell.runAndAdvance'
  | 'cell.moveUp'
  | 'cell.moveDown'
  | 'cell.insertBelow'
  | 'cell.toggleType'
  | 'cell.toggleHideSource'
  | 'notebook.forceSync'
  | 'app.openShortcuts';

export interface CommandContext {
  activeCellId: string | null;
  activeCellState: CellState;
  isModalOpen: boolean;
  isTitleEditing: boolean;
  isTextInputFocused: boolean;
}

export interface ShortcutBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Optional restriction to specific cell mode */
  whenMode?: 'VIEWING' | 'EDITING' | 'ANY';
}

export interface RegisteredCommand {
  id: CommandId;
  label: string;
  description: string;
  shortcutDisplay: string;
  bindings: ShortcutBinding[];
  execute: (ctx: CommandContext) => void | Promise<void>;
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}

export function matchesBinding(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  binding: ShortcutBinding,
  mode: CellState
): boolean {
  if (binding.whenMode === 'VIEWING' && mode === 'EDITING') return false;
  if (binding.whenMode === 'EDITING' && mode !== 'EDITING') return false;

  const eventKey = normalizeKey(event.key);
  const bindingKey = normalizeKey(binding.key);
  if (eventKey !== bindingKey) return false;

  const hasCtrl = Boolean(event.ctrlKey || event.metaKey);
  if (Boolean(binding.ctrl) !== hasCtrl) return false;
  if (Boolean(binding.shift) !== Boolean(event.shiftKey)) return false;
  if (Boolean(binding.alt) !== Boolean(event.altKey)) return false;

  return true;
}

export class CommandRegistry {
  private commands = new Map<CommandId, RegisteredCommand>();

  register(command: RegisteredCommand): void {
    this.commands.set(command.id, command);
  }

  registerMany(commands: RegisteredCommand[]): void {
    for (const cmd of commands) {
      this.register(cmd);
    }
  }

  unregister(id: CommandId): void {
    this.commands.delete(id);
  }

  clear(): void {
    this.commands.clear();
  }

  list(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  executeById(id: CommandId, ctx: CommandContext): boolean {
    const cmd = this.commands.get(id);
    if (!cmd) return false;
    void cmd.execute(ctx);
    return true;
  }

  /**
   * Matches a KeyboardEvent against registered commands and executes the first match.
   * Returns true if a command handled the event (caller should preventDefault/stopPropagation).
   */
  handleKeyEvent(
    event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
    ctx: CommandContext
  ): CommandId | null {
    // Allow Ctrl+/ to toggle shortcuts modal even when modal is open; block other shortcuts when modal/title input is active
    if (ctx.isTitleEditing) {
      return null;
    }

    for (const cmd of this.commands.values()) {
      if (ctx.isModalOpen && cmd.id !== 'app.openShortcuts') {
        continue;
      }

      for (const binding of cmd.bindings) {
        // When a plain input/textarea outside CodeMirror is focused, don't hijack Enter or Arrow keys
        if (
          ctx.isTextInputFocused &&
          !binding.ctrl &&
          !binding.alt
        ) {
          continue;
        }

        if (matchesBinding(event, binding, ctx.activeCellState)) {
          void cmd.execute(ctx);
          return cmd.id;
        }
      }
    }

    return null;
  }
}
