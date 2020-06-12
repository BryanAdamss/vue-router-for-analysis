/* @flow */

import type VueRouter from './index'
import { resolvePath } from './util/path'
import { assert, warn } from './util/warn'
import { createRoute } from './util/route'
import { fillParams } from './util/params'
import { createRouteMap } from './create-route-map'
import { normalizeLocation } from './util/location'

export type Matcher = {
  match: (raw: RawLocation, current?: Route, redirectedFrom?: Location) => Route;
  addRoutes: (routes: Array<RouteConfig>) => void;
};

export function createMatcher (
  routes: Array<RouteConfig>, // 路由配置列表
  router: VueRouter // VueRouter实例
): Matcher {
  const { pathList, pathMap, nameMap } = createRouteMap(routes) // 创建路由映射表
  // 添加路由
  function addRoutes (routes) {
    // 由于传入pathList, pathMap, nameMap了，所以createRouteMap方法会执行添加逻辑
    createRouteMap(routes, pathList, pathMap, nameMap)
  }
  // 传入location,返回匹配的Route对象
  function match (
    raw: RawLocation,
    currentRoute?: Route,
    redirectedFrom?: Location
  ): Route {
    // 获取格式化后的location，由于闭包特性，所以此处能访问到router实例
    const location = normalizeLocation(raw, currentRoute, false, router)
    const { name } = location
    // 通过name匹配
    if (name) {
      const record = nameMap[name]
      if (process.env.NODE_ENV !== 'production') {
        // 未找到警告
        warn(record, `Route with name '${name}' does not exist`)
      }
      // 未找到路由记录，则创建一个空Route返回
      if (!record) return _createRoute(null, location)
      // 获取动态路由参数名
      const paramNames = record.regex.keys
        .filter(key => !key.optional)
        .map(key => key.name)

      if (typeof location.params !== 'object') {
        location.params = {}
      }
      // 提取当前Route中符合动态路由参数名的值赋值给location
      if (currentRoute && typeof currentRoute.params === 'object') {
        for (const key in currentRoute.params) {
          if (!(key in location.params) && paramNames.indexOf(key) > -1) {
            location.params[key] = currentRoute.params[key]
          }
        }
      }
      // 填充params
      location.path = fillParams(record.path, location.params, `named route "${name}"`)
      // 创建route
      return _createRoute(record, location, redirectedFrom)
    } else if (location.path) {
      location.params = {}
      // 遍历pathList，找到能匹配到的记录，然后生成Route
      for (let i = 0; i < pathList.length; i++) {
        const path = pathList[i]
        const record = pathMap[path]
        if (matchRoute(record.regex, location.path, location.params)) {
          // 找到匹配的路由记录后，生成对应Route
          return _createRoute(record, location, redirectedFrom)
        }
      }
    }
    // no match
    return _createRoute(null, location)
  }
  // 创建重定向Route
  function redirect (
    record: RouteRecord, // 触发重定向的路由记录(需要进行重定向的路由记录，包含redirect)
    location: Location // 触发重定向的初始地址（多次重定向时用到）
  ): Route {
    const originalRedirect = record.redirect
    let redirect = typeof originalRedirect === 'function' // redirect支持传入函数;https://router.vuejs.org/zh/guide/essentials/redirect-and-alias.html#重定向
      ? originalRedirect(createRoute(record, location, null, router))
      : originalRedirect
    // redirect返回的是一个路径path，如'/bar'
    if (typeof redirect === 'string') {
      redirect = { path: redirect }
    }
    // originalRedirect函数返回一个非string、非object的值时，给予警告，并创建一个空Route
    if (!redirect || typeof redirect !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false, `invalid redirect option: ${JSON.stringify(redirect)}`
        )
      }
      return _createRoute(null, location)
    }
    // 到这一步，redirect一定是个object
    const re: Object = redirect
    const { name, path } = re
    let { query, hash, params } = location
    query = re.hasOwnProperty('query') ? re.query : query
    hash = re.hasOwnProperty('hash') ? re.hash : hash
    params = re.hasOwnProperty('params') ? re.params : params
    // 重定向是命名路由形式
    if (name) {
      // resolved named direct
      const targetRecord = nameMap[name]
      // 未找到命名路由警告
      if (process.env.NODE_ENV !== 'production') {
        assert(targetRecord, `redirect failed: named route "${name}" not found.`)
      }
      return match({
        _normalized: true,
        name,
        query,
        hash,
        params
      }, undefined, location)
    } else if (path) {
      // 重定向是path形式
      // 1. resolve relative redirect，解析出完整路径
      const rawPath = resolveRecordPath(path, record)
      // 2. resolve params，填充params
      const resolvedPath = fillParams(rawPath, params, `redirect route with path "${rawPath}"`)
      // 3. rematch with existing query and hash，重新匹配
      return match({
        _normalized: true,
        path: resolvedPath,
        query,
        hash
      }, undefined, location)
    } else {
      if (process.env.NODE_ENV !== 'production') {
        warn(false, `invalid redirect option: ${JSON.stringify(redirect)}`)
      }
      return _createRoute(null, location)
    }
  }
  // 创建别名Route
  function alias (
    record: RouteRecord,
    location: Location,
    matchAs: string
  ): Route {
    // 获取别名的完整路径
    const aliasedPath = fillParams(matchAs, location.params, `aliased route with path "${matchAs}"`)
    // 获取别名匹配的原始Route
    const aliasedMatch = match({
      _normalized: true,
      path: aliasedPath
    })
    if (aliasedMatch) {
      const matched = aliasedMatch.matched
      const aliasedRecord = matched[matched.length - 1] // 找到所有匹配的路由记录的最后一个，即当前匹配的路由记录，逻辑见route.js formatMatch方法
      location.params = aliasedMatch.params
      return _createRoute(aliasedRecord, location)
    }
    return _createRoute(null, location)
  }

  function _createRoute (
    record: ?RouteRecord,
    location: Location,
    redirectedFrom?: Location
  ): Route {
    // 路由记录被标记为重定向
    if (record && record.redirect) {
      return redirect(record, redirectedFrom || location)
    }
    // 路由记录被标记为别名路由，见create-route-map.js
    if (record && record.matchAs) {
      return alias(record, location, record.matchAs)
    }
    // 正常路由记录
    return createRoute(record, location, redirectedFrom, router)
  }

  // 返回Matcher对象，暴露match、addRoutes方法
  return {
    match,
    addRoutes
  }
}
// 检查path是否能通过regex的匹配，并对params对象正确赋值
function matchRoute (
  regex: RouteRegExp,
  path: string,
  params: Object
): boolean {
  const m = path.match(regex)

  if (!m) { // 无法匹配上
    return false
  } else if (!params) { // 符合正则 && params不存在，则表示可以匹配
    return true
  }
  // 符合正则 && params存在，需要对params进行正确赋值
  // path-to-regexp会将每个动态路由标记处处理成正则的一个组，所以i从1开始
  // 参考https://www.npmjs.com/package/path-to-regexp
  // const keys = [];
  // const regexp = pathToRegexp("/foo/:bar", keys);
  // regexp = /^\/foo\/([^\/]+?)\/?$/i
  // :bar就被处理成正则的一个组了
  // keys = [{ name: 'bar', prefix: '/', suffix: '', pattern: '[^\\/#\\?]+?', modifier: '' }]
  for (let i = 1, len = m.length; i < len; ++i) {
    const key = regex.keys[i - 1] // regex.keys返回匹配到的
    const val = typeof m[i] === 'string' ? decodeURIComponent(m[i]) : m[i]
    if (key) {
      // Fix #1994: using * with props: true generates a param named 0
      params[key.name || 'pathMatch'] = val
    }
  }

  return true
}
// 解析record中的path
function resolveRecordPath (path: string, record: RouteRecord): string {
  return resolvePath(path, record.parent ? record.parent.path : '/', true)
}
