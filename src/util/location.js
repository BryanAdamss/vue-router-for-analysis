/* @flow */

import type VueRouter from '../index'
import { parsePath, resolvePath } from './path'
import { resolveQuery } from './query'
import { fillParams } from './params'
import { warn } from './warn'
import { extend } from './misc'
// 格式化location
export function normalizeLocation (
  raw: RawLocation, // 原始location，一个string，或者是一个已经格式化后的location
  current: ?Route, // 当前路由对象
  append: ?boolean, // 是否是追加模式
  router: ?VueRouter// VueRouter实例
): Location {
  let next: Location = typeof raw === 'string' ? { path: raw } : raw
  // named target
  // 已经格式化过，直接返回
  if (next._normalized) {
    return next
  } else if (next.name) {
    // 处理命名形式，例如{name:'Home',params:{id:3}}
    next = extend({}, raw)
    const params = next.params
    if (params && typeof params === 'object') {
      next.params = extend({}, params)
    }
    return next
  }

  // relative params
  // 处理{params:{id:1}}相对参数形式跳转
  if (!next.path && next.params && current) {
    next = extend({}, next)
    next._normalized = true
    const params: any = extend(extend({}, current.params), next.params)
    // 提取当前route的字段做为next的字段，因为相对参数形式，只有params，必须借助current提取一些字段
    if (current.name) {
      // 命名形式
      next.name = current.name
      next.params = params
    } else if (current.matched.length) {
      // path形式，从匹配记录中提取出当前path并填充参数
      const rawPath = current.matched[current.matched.length - 1].path
      next.path = fillParams(rawPath, params, `path ${current.path}`)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }
  // 处理path形式跳转，例如{path:'/test',query:{test:3}}
  // 解析path
  const parsedPath = parsePath(next.path || '')
  const basePath = (current && current.path) || '/'
  const path = parsedPath.path
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath
  // 解析query
  const query = resolveQuery(
    parsedPath.query,
    next.query, // 额外需要追加的qs
    router && router.options.parseQuery // 支持传入自定义解析query的方法
  )
  // 解析hash
  let hash = next.hash || parsedPath.hash
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }

  return {
    _normalized: true, // 标识已经格式化过
    path,
    query,
    hash
  }
}
