type FilterPattern = Array<string | RegExp> | string | RegExp

type Awaitable<T> = T | Promise<T>

export type TransformFn = (
  id: string,
  importer: string,
) => Awaitable<boolean | undefined | void>

export interface Options {
  include?: FilterPattern
  exclude?: FilterPattern
  order?: 'pre' | 'post' | undefined
  /**
   * A function to determine whether a module should be transformed.
   * Return `true` to force transformation, `false` to skip transformation,
   * or `undefined` to let the plugin decide automatically.
   *
   * @param id The module ID (path) being imported.
   * @param importer The module ID (path) of the importer.
   * @returns A boolean or a promise that resolves to a boolean, or `undefined`.
   */
  shouldTransform?: string[] | TransformFn
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Options>,
  Pick<Options, 'order'> & { shouldTransform?: TransformFn }
>

export function resolveOptions(options: Options): OptionsResolved {
  let { shouldTransform } = options
  if (Array.isArray(shouldTransform)) {
    shouldTransform = (id) => (shouldTransform as string[]).includes(id)
  }

  return {
    include: options.include || [/\.[cm]?[jt]sx?$/],
    exclude: options.exclude || [/node_modules/, /\.d\.[cm]?ts$/],
    order: 'order' in options ? options.order : 'pre',
    shouldTransform,
  }
}
