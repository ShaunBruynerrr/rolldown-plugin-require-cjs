import { readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { init, parse } from 'cjs-module-lexer'
import { up } from 'empathic/package'
import { generateTransform, MagicStringAST } from 'magic-string-ast'
import { resolvePathSync } from 'mlly'
import { parseAst } from 'rolldown/parseAst'
import { resolveOptions, type Options } from './options'
import type { Plugin } from 'rolldown'

export * from './options'

let initted = false

export function RequireCJS(userOptions: Options = {}): Plugin {
  const { include, exclude, order, shouldTransform, builtinNodeModules } =
    resolveOptions(userOptions)

  return {
    name: 'rolldown-plugin-require-cjs',
    async buildStart() {
      if (!initted) {
        await init()
        initted = true
      }
    },
    options(options) {
      if (options.platform !== 'node') {
        this.error(
          '`rolldown-plugin-require-cjs` plugin is designed only for the Node.js environment. Please make sure to set `platform: "node"` in the options.',
        )
      }
    },
    outputOptions(options) {
      if (!['es', 'esm', 'module'].includes(options.format as any)) {
        throw new Error(
          '`rolldown-plugin-require-cjs` plugin is only necessary for ESM output',
        )
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

            const isBuiltinModule =
              builtinNodeModules &&
              (builtinModules.includes(source) || source.startsWith('node:'))

            const resolution = isBuiltinModule
              ? null // skip resolution for built-in modules
              : await this.resolve(source, id)
            if (resolution && resolution.external === false) {
              // internal resolution, skip
              // we only care about external CJS modules
              continue
            }

            const shouldProcess =
              isBuiltinModule ||
              ((await shouldTransform?.(source, id)) ??
                (await isPureCJS(source, id)))
            if (!shouldProcess) continue

            if (stmt.specifiers.length === 0) {
              // import 'cjs-module'
              if (isBuiltinModule) {
                // side-effect free
                s.removeNode(stmt)
              } else {
                // require('cjs-module')
                s.overwriteNode(stmt, `require(${s.sliceNode(stmt.source)});`)
              }
              continue
            }

            const mapping: Record<string, string> = {}
            let namespaceId: string | undefined
            let defaultId: string | undefined
            for (const specifier of stmt.specifiers) {
              // namespace
              if (specifier.type === 'ImportNamespaceSpecifier') {
                // import * as name from 'cjs-module'
                namespaceId = s.sliceNode(specifier.local)
              } else if (specifier.type === 'ImportSpecifier') {
                if (specifier.importKind === 'type') continue
                // named import
                mapping[s.sliceNode(specifier.imported)] = s.sliceNode(
                  specifier.local,
                )
              } else {
                // default import
                defaultId = s.sliceNode(specifier.local)
              }
            }
            const requireCode = isBuiltinModule
              ? `process.getBuiltinModule(${s.sliceNode(stmt.source)})`
              : `require(${s.sliceNode(stmt.source)})`

            let str = ''
            if (namespaceId) {
              defaultId ||= `_cjs_${namespaceId}_default`
            }
            if (defaultId) {
              // const name = require('cjs-module')
              str += `const ${defaultId} = ${requireCode};`
            }
            if (namespaceId) {
              // const ns = { ...default, default }
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

        return generateTransform(s, id)
      },
    },
  }
}

export async function isPureCJS(
  id: string,
  importer: string,
): Promise<boolean> {
  if (!initted) {
    await init()
  }

  // ignore Node.js built-in modules, as their performance is comparable
  if (id.startsWith('node:')) return false

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
