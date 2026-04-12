import * as monaco from 'monaco-editor'
import { conf as csharpConf, language as baseCSharpLanguage } from 'monaco-editor/esm/vs/basic-languages/csharp/csharp'

let registered = false

export function registerEnhancedCSharpLanguage(): void {
  if (registered) return

  if (!monaco.languages.getLanguages().some((language) => language.id === 'csharp')) {
    monaco.languages.register({
      id: 'csharp',
      extensions: ['.cs', '.csx'],
      aliases: ['C#', 'csharp'],
    })
  }

  monaco.languages.setLanguageConfiguration('csharp', csharpConf)

  const enhancedLanguage = {
    ...baseCSharpLanguage,
    tokenizer: {
      ...baseCSharpLanguage.tokenizer,
      root: [
        // Add semantic-looking color hooks without changing Monaco's tokenizer state machine.
        [/(class)(\s+)([A-Za-z_]\w*)/, ['keyword.class', '', 'class.name']],
        [/(interface)(\s+)([A-Za-z_]\w*)/, ['keyword.interface', '', 'interface.name']],
        [/(struct)(\s+)([A-Za-z_]\w*)/, ['keyword.struct', '', 'struct.name']],
        [/(enum)(\s+)([A-Za-z_]\w*)/, ['keyword.enum', '', 'enum.name']],
        [/(record)(\s+)(class|struct)(\s+)([A-Za-z_]\w*)/, ['keyword.record', '', 'keyword', '', 'record.name']],
        [/(record)(\s+)([A-Za-z_]\w*)/, ['keyword.record', '', 'record.name']],
        [/(new)(\s+)([A-Za-z_][\w.]*)/, ['keyword.new', '', 'class.name']],
        [/(\[)(\s*)([A-Za-z_]\w*)/, ['delimiter.square', '', 'attribute.name']],
        [/\bI[A-Z][A-Za-z0-9_]*(?=\s*[<\[\]?]*\s+[@_a-zA-Z])/, 'interface.name'],
        [/\bI[A-Z][A-Za-z0-9_]*/, 'interface.name'],
        [/\b[A-Z][A-Za-z0-9_]*(?=\s*\()/, 'constructor.name'],
        [/\b[A-Z][A-Za-z0-9_]*(?=\s*[=;{])/, 'property.name'],
        [/\b_[a-zA-Z][A-Za-z0-9_]*/, 'field.name'],
        [/\@?[a-zA-Z_]\w*(?=\s*\()/, 'function'],
        [/[A-Z][A-Za-z0-9_]*(?=\s*[<\[\]?]*\s+[@_a-zA-Z])/, 'class.name'],
        [/[A-Z][A-Za-z0-9_]*/, 'class.name'],
        ...baseCSharpLanguage.tokenizer.root,
      ],
      qualified: [
        [/[A-Z][A-Za-z0-9_]*(?=\s*\()/, 'function'],
        [/[A-Z][A-Za-z0-9_]*/, 'property.name'],
        [/[a-z_][A-Za-z0-9_]*/, 'property.name'],
        ...(baseCSharpLanguage.tokenizer.qualified ?? []),
      ],
    },
  }

  try {
    monaco.languages.setMonarchTokensProvider('csharp', enhancedLanguage)
  } catch (error) {
    console.warn('Failed to register enhanced C# language, falling back to Monaco default.', error)
    try {
      monaco.languages.setMonarchTokensProvider('csharp', baseCSharpLanguage)
    } catch (fallbackError) {
      console.warn('Failed to register default C# language provider.', fallbackError)
    }
  }

  registered = true
}
