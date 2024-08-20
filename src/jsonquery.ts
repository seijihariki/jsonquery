import {
  Evaluator,
  FunctionsMap,
  Getter,
  JSONProperty,
  JSONQuery,
  JSONQueryFunction,
  JSONQueryObject,
  JSONQueryOperator,
  Operator
} from './types'

export function jsonquery(data: unknown, query: JSONQuery, functions?: FunctionsMap): unknown {
  const compiled = compile(query, functions)

  return compiled(data)
}

export function compile(query: JSONQuery, functions?: FunctionsMap): Evaluator {
  functionsStack.unshift({
    ...(functionsStack[0] as object),
    ...(functions as object | undefined)
  })

  const result = _compile(query)

  functionsStack.shift()

  return result
}

function _compile(query: JSONQuery): Evaluator {
  // object
  if (isObject(query)) {
    return object(query as JSONQueryObject)
  }

  if (isArray(query)) {
    // function
    const [fnName, ...args] = query as unknown as JSONQueryFunction
    const fn = functionsStack[0][fnName]
    if (fn) {
      return fn(...args)
    }

    // operator
    const [left, opName, ...right] = query as unknown as JSONQueryOperator
    const op = coreOperators[opName]
    if (op) {
      return op(...[left, ...right])
    }
    const rawOp = rawOperators[opName]
    if (rawOp) {
      const a = compile(left)
      const b = compile(right)
      return (data: unknown) => rawOp(a(data), b(data))
    }

    // pipe
    return pipe(query as JSONQuery[])
  }

  // property without brackets
  if (isString(query)) {
    return get(query)
  }

  // value
  return () => query
}

export const get = (property: JSONProperty) =>
  isString(property)
    ? (data: unknown) => data?.[property]
    : (data: unknown) => {
        let value = data

        for (const prop of property) {
          value = value?.[prop]
        }

        return value
      }

export const string = (text: string) => () => text

export const map = <T>(callback: JSONQuery) => {
  const _callback = compile(callback)
  return (data: T[]) => data.map(_callback)
}

export const filter = <T>(predicate: JSONQuery) => {
  const _predicate = compile(predicate)
  return (data: T[]) => data.filter(_predicate)
}

export const pipe = (entries: JSONQuery[]) => {
  const _entries = entries.map(compile)
  return (data: unknown) => _entries.reduce((data, evaluator) => evaluator(data), data)
}

export const object = (query: JSONQueryObject) => {
  const getters: Getter[] = Object.keys(query).map((key) => [key, compile(query[key])])

  return (data: unknown) => {
    const obj = {}
    getters.forEach(([key, getter]) => (obj[key] = getter(data)))
    return obj
  }
}

export const sort = <T>(property: JSONProperty = [], direction?: 'asc' | 'desc') => {
  const getter = get(property)
  const sign = direction === 'desc' ? -1 : 1

  function compare(itemA: unknown, itemB: unknown) {
    const a = getter(itemA)
    const b = getter(itemB)
    return a > b ? sign : a < b ? -sign : 0
  }

  return (data: T[]) => data.slice().sort(compare)
}

export const pick = (...properties: JSONProperty[]) => {
  const getters: Getter[] = properties.map((property) => [
    isString(property) ? property : property[property.length - 1],
    get(property)
  ])

  return (data: Record<string, unknown>): unknown => {
    if (isArray(data)) {
      return data.map((item: Record<string, unknown>) => _pick(item, getters))
    }

    return _pick(data, getters)
  }
}

const _pick = (object: Record<string, unknown>, getters: Getter[]): unknown => {
  const out = {}

  getters.forEach(([key, getter]) => {
    out[key] = getter(object)
  })

  return out
}

export const groupBy = <T>(property: JSONProperty) => {
  const getter = get(property)

  return (data: T[]) => {
    const res = {}

    for (const item of data) {
      const value = getter(item) as string
      if (res[value]) {
        res[value].push(item)
      } else {
        res[value] = [item]
      }
    }

    return res
  }
}

export const keyBy = <T>(property: JSONProperty) => {
  const getter = get(property)

  return (data: T[]) => {
    const res = {}

    data.forEach((item) => {
      const value = getter(item) as string
      res[value] = item
    })

    return res
  }
}

export const flatten = () => (data: unknown[]) => data.flat()

export const uniq =
  () =>
  <T>(data: T[]) => [...new Set(data)]

export const uniqBy =
  <T>(property: JSONProperty) =>
  (data: T[]): T[] =>
    Object.values(groupBy(property)(data)).map((groups) => groups[0])

export const limit =
  (count: number) =>
  <T>(data: T[]) =>
    data.slice(0, count)

export const keys = () => Object.keys

export const values = () => Object.values

export const prod = () => (data: number[]) => data.reduce((a, b) => a * b)

export const sum = () => (data: number[]) => data.reduce((a, b) => a + b)

export const average = () => (data: number[]) => sum()(data) / data.length

export const min = () => (data: number[]) => Math.min(...data)

export const max = () => (data: number[]) => Math.max(...data)

export const round =
  (digits = 0) =>
  (data: number) => {
    const num = Math.round(Number(data + 'e' + digits))
    return Number(num + 'e' + -digits)
  }

export const size =
  () =>
  <T>(data: T[]) =>
    data.length

const coreFunctions: FunctionsMap = {
  map,
  filter,
  get,
  string,
  sort,
  pick,
  groupBy,
  keyBy,
  keys,
  values,
  flatten,
  uniq,
  uniqBy,
  size,
  limit,
  sum,
  min,
  max,
  prod,
  average,
  round
}

const functionsStack: FunctionsMap[] = [coreFunctions]

const rawOperators: Record<string, Operator> = {
  '==': (a, b) => a == b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '!=': (a, b) => a != b,

  and: (a, b) => a && b,
  or: (a, b) => a || b,

  '+': (a: number, b: number) => a + b,
  '-': (a: number, b: number) => a - b,
  '*': (a: number, b: number) => a * b,
  '/': (a: number, b: number) => a / b
}

const coreOperators: FunctionsMap = {
  in: (property: string, values: string[]) => {
    const getter = get(property)
    return (data: unknown) => values.includes(getter(data))
  },
  'not in': (property: string, values: string[]) => {
    const getter = get(property)
    return (data: unknown) => !values.includes(getter(data))
  },
  regex: (property: string, expression: string, options?: string) => {
    const regex = new RegExp(expression, options)
    const getter = get(property)
    return (data: unknown) => regex.test(getter(data) as string)
  }
}

const isArray = <T>(value: unknown): value is T[] => Array.isArray(value)

const isObject = (value: unknown): value is object =>
  value && typeof value === 'object' && !isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
