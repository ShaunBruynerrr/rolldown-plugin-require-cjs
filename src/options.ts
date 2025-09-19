type FilterPattern = Array<string | RegExp> | string | RegExp

type Awaitable<T> = T | Promise<T>

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
  shouldTransform?: (
    id: string,
    importer: string,
  ) => Awaitable<boolean | undefined | void>
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Options>,
  Pick<Options, 'order' | 'shouldTransform'>
>

export function resolveOptions(options: Options): OptionsResolved {
  return {
    include: options.include || [/\.[cm]?[jt]sx?$/],
    exclude: options.exclude || [/node_modules/, /\.d\.[cm]?ts$/],
    order: 'order' in options ? options.order : 'pre',
    shouldTransform: options.shouldTransform,
  }
}
