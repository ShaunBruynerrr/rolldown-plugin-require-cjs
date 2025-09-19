import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { init, parse } from 'cjs-module-lexer'
import { up } from 'empathic/package'
import { generateTransform, MagicStringAST } from 'magic-string-ast'
import { resolvePathSync } from 'mlly'
import { parseAst } from 'rolldown/parseAst'
import { resolveOptions, type Options } from './options'
import type { Plugin } from 'rolldown'

export * from './options'

export function RequireCJS(userOptions: Options = {}): Plugin {
  const { include, exclude, order, shouldTransform } =
    resolveOptions(userOptions)

  return {
    name: 'rolldown-plugin-require-cjs',
    async buildStart() {
      await init()
    },
    outputOptions(options) {
      if (!['es', 'esm', 'module'].includes(options.format as any)) {
        throw new Error('RequireCJS plugin is only necessary for ESM output')
      }
    },
    transform: {
      filter: {
        id: { include, exclude },
      },
      order,
      async handler(code, id) {
        const { body } = parseAst(code, { lang: undefined }, id)
        const s = new MagicStringAST(code)

        for (const stmt of body) {
          if (stmt.type === 'ImportDeclaration') {
            if (stmt.importKind === 'type') continue

            const source = stmt.source.value

            const resolution = await this.resolve(source, id)
            if (resolution && resolution.external === false) {
              continue
            }

            const result =
              (await shouldTransform?.(source, id)) ??
              (await isPureCJS(source, id))
            if (!result) {
              continue
            }

            if (stmt.specifiers.length === 0) {
              // import 'cjs-module'
              // require('cjs-module')
              s.overwriteNode(stmt, `require(${s.sliceNode(stmt.source)});`)
            } else {
              const mapping: Record<string, string> = {}
              let namespaceId: string | undefined
              let defaultId: string | undefined
              for (const specifier of stmt.specifiers) {
                // namespace
                if (specifier.type === 'ImportNamespaceSpecifier') {
                  // import * as name from 'cjs-module'
                  // const name = require('cjs-module')
                  namespaceId = s.sliceNode(specifier.local)
                } else if (specifier.type === 'ImportSpecifier') {
                  // named import
                  mapping[s.sliceNode(specifier.imported)] = s.sliceNode(
                    specifier.local,
                  )
                } else {
                  // default import
                  defaultId = s.sliceNode(specifier.local)
                }
              }
              const requireCode = `require(${s.sliceNode(stmt.source)})`

              let str = ''
              if (namespaceId) {
                defaultId ||= `_cjs_${namespaceId}_mod`
              }
              if (defaultId) {
                str += `const ${defaultId} = ${requireCode};`
              }
              if (namespaceId) {
                str += `const ${namespaceId} = { ...${defaultId}, default: ${defaultId} };`
              }
              if (Object.keys(mapping).length > 0) {
                str += `const { ${Object.entries(mapping)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')} } = ${defaultId || requireCode};`
              }
              s.overwriteNode(stmt, str)
            }
          }
        }

        return generateTransform(s, id)
      },
    },
  }
}

export async function isPureCJS(
  id: string,
  importer: string,
): Promise<boolean> {
  try {
    const importResolved = resolvePathSync(id, { url: importer })
    const requireResolved = require.resolve(id, { paths: [importer] })

    // different resolution, respect to original behavior
    if (path.resolve(importResolved) !== path.resolve(requireResolved)) {
      return false
    }

    if (importResolved.endsWith('.cjs')) {
      return true
    } else if (importResolved.endsWith('.js')) {
      const pkgJsonPath = up({ cwd: importResolved })
      if (pkgJsonPath) {
        const pkgType = await getPackageType(pkgJsonPath)
        if (pkgType === 'module') return false
        if (pkgType === 'commonjs') return true
      }

      // detect by parsing
      const contents = await readFile(importResolved, 'utf8')
      try {
        parse(contents, importResolved)
        return true
      } catch {}
    }
  } catch {}
  return false
}

async function getPackageType(path: string): Promise<string | undefined> {
  const contents = await readFile(path, 'utf8')
  try {
    const pkg = JSON.parse(contents)
    return pkg.type as string | undefined
  } catch {}
}
