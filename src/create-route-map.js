/* @flow */

import Regexp from 'path-to-regexp'
import { cleanPath } from './util/path'
import { assert, warn } from './util/warn'

// 创建路由映射map、添加路由记录
export function createRouteMap (
  routes: Array<RouteConfig>, // 路由配置列表
  oldPathList?: Array<string>, // 旧pathList
  oldPathMap?: Dictionary<RouteRecord>, // 旧pathMap
  oldNameMap?: Dictionary<RouteRecord>// 旧nameMap
): {
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>
} {
  // 若旧的路由相关映射列表及map存在，则使用旧的初始化（借此实现添加路由功能）
  // the path list is used to control path matching priority
  const pathList: Array<string> = oldPathList || []
  // $flow-disable-line
  const pathMap: Dictionary<RouteRecord> = oldPathMap || Object.create(null)
  // $flow-disable-line
  const nameMap: Dictionary<RouteRecord> = oldNameMap || Object.create(null)
  // 遍历路由配置对象，生成/添加路由记录
  routes.forEach(route => {
    addRouteRecord(pathList, pathMap, nameMap, route)
  })

  // ensure wildcard routes are always at the end
  // 确保path:*永远在在最后
  for (let i = 0, l = pathList.length; i < l; i++) {
    if (pathList[i] === '*') {
      pathList.push(pathList.splice(i, 1)[0])
      l--
      i--
    }
  }
  // 开发环境，提示非嵌套路由的path必须以/或者*开头
  if (process.env.NODE_ENV === 'development') {
    // warn if routes do not include leading slashes
    const found = pathList
    // check for missing leading slash
      .filter(path => path && path.charAt(0) !== '*' && path.charAt(0) !== '/')

    if (found.length > 0) {
      const pathNames = found.map(path => `- ${path}`).join('\n')
      warn(false, `Non-nested routes must include a leading slash character. Fix the following routes: \n${pathNames}`)
    }
  }

  return {
    pathList,
    pathMap,
    nameMap
  }
}
// 添加路由记录，更新pathList、pathMap、nameMap
function addRouteRecord (
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>,
  route: RouteConfig,
  parent?: RouteRecord, // 父路由时记录
  matchAs?: string // 处理别名路由时使用
) {
  const { path, name } = route
  if (process.env.NODE_ENV !== 'production') {
    // route.path不能为空
    assert(path != null, `"path" is required in a route configuration.`)
    // route.component不能为string
    assert(
      typeof route.component !== 'string',
      `route config "component" for path: ${String(
        path || name
      )} cannot be a ` + `string id. Use an actual component instead.`
    )
  }

  const pathToRegexpOptions: PathToRegexpOptions =
    route.pathToRegexpOptions || {}
  // 生成格式化后的path(子路由会拼接上父路由的path)
  const normalizedPath = normalizePath(path, parent, pathToRegexpOptions.strict)
  // 匹配规则是否大小写敏感？(默认值：false)
  if (typeof route.caseSensitive === 'boolean') {
    pathToRegexpOptions.sensitive = route.caseSensitive
  }
  // 生成一条路由记录
  const record: RouteRecord = {
    path: normalizedPath,
    regex: compileRouteRegex(normalizedPath, pathToRegexpOptions), // 利用path-to-regexp包生成用来匹配path的增强正则对象，可以用来匹配动态路由
    components: route.components || { default: route.component }, // 保存路由组件，支持命名视图https://router.vuejs.org/zh/guide/essentials/named-views.html#%E5%91%BD%E5%90%8D%E8%A7%86%E5%9B%BE
    instances: {}, // 保存每个命名router-view需要渲染的路由组件
    name,
    parent,
    matchAs,
    redirect: route.redirect, // 重定向的路由配置对象
    beforeEnter: route.beforeEnter, // 路由独享的守卫
    meta: route.meta || {}, // 元信息
    props: // 动态路由传参；https://router.vuejs.org/zh/guide/essentials/passing-props.html#%E8%B7%AF%E7%94%B1%E7%BB%84%E4%BB%B6%E4%BC%A0%E5%8F%82
      route.props == null
        ? {}
        : route.components // 命名视图的传参规则需要使用route.props指定的规则
          ? route.props
          : { default: route.props }
  }
  // 处理有子路由情况
  if (route.children) {
    // Warn if route is named, does not redirect and has a default child route.
    // If users navigate to this route by name, the default child will
    // not be rendered (GH Issue #629)
    // https://github.com/vuejs/vue-router/issues/629
    // 命名路由 && 未使用重定向 && 子路由配置对象path为''或/时，使用父路由的name跳转时，子路由将不会被渲染
    if (process.env.NODE_ENV !== 'production') {
      if (
        route.name &&
        !route.redirect &&
        route.children.some(child => /^\/?$/.test(child.path))
      ) {
        warn(
          false,
          `Named Route '${route.name}' has a default child route. ` +
            `When navigating to this named route (:to="{name: '${
              route.name
            }'"), ` +
            `the default child route will not be rendered. Remove the name from ` +
            `this route and use the name of the default child route for named ` +
            `links instead.`
        )
      }
    }
    // 遍历生成子路由记录
    route.children.forEach(child => {
      const childMatchAs = matchAs // matchAs若有值，代表当前路由是别名路由，则需要单独生成别名路由的子路由，路径前缀需使用matchAs
        ? cleanPath(`${matchAs}/${child.path}`)
        : undefined
      addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
    })
  }
  // 若pathMap中不存在当前路径，则更新pathList和pathMap
  if (!pathMap[record.path]) {
    pathList.push(record.path)
    pathMap[record.path] = record
  }
  // 处理别名；https://router.vuejs.org/zh/guide/essentials/redirect-and-alias.html#%E5%88%AB%E5%90%8D
  if (route.alias !== undefined) {
    const aliases = Array.isArray(route.alias) ? route.alias : [route.alias] // alias支持string，和Array<String>
    for (let i = 0; i < aliases.length; ++i) {
      const alias = aliases[i]
      if (process.env.NODE_ENV !== 'production' && alias === path) { // alias的值和path重复，需要给提示
        warn(
          false,
          `Found an alias with the same value as the path: "${path}". You have to remove that alias. It will be ignored in development.`
        )
        // skip in dev to make it work
        continue
      }
      // 生成别名路由配置对象
      const aliasRoute = {
        path: alias,
        children: route.children
      }
      // 添加别名路由记录
      addRouteRecord(
        pathList,
        pathMap,
        nameMap,
        aliasRoute, // 别名路由
        parent, // 当前路由的父路由，因为是给当前路由取了个别名，所以二者其实是有同个父路由的
        record.path || '/' // matchAs，用来生成别名路由的子路由；
      )
      // ! 总结：当前路由设置了alias后，会单独为当前路由及其所有子路由生成路由记录，且子路由的path前缀为matchAs(即别名路由的path)
    }
  }
  // 处理命名路由
  if (name) {
    // 更新nameMap
    if (!nameMap[name]) {
      nameMap[name] = record
    } else if (process.env.NODE_ENV !== 'production' && !matchAs) {
      // 路由重名警告
      warn(
        false,
        `Duplicate named routes definition: ` +
          `{ name: "${name}", path: "${record.path}" }`
      )
    }
  }
}
// 使用path-to-regexp包，生成route对应的正则，可以用来生成动态路由需要的正则表达式
function compileRouteRegex (
  path: string,
  pathToRegexpOptions: PathToRegexpOptions
): RouteRegExp {
  // Regexp接收三个参数path，keys，options；path为需要转换为正则的路径，keys，是用来接收在path中找到的key，options为选项
  // 参考https://www.npmjs.com/package/path-to-regexp
  // const keys = [];
  // const regexp = pathToRegexp("/foo/:bar", keys);
  // regexp = /^\/foo\/([^\/]+?)\/?$/i
  // keys = [{ name: 'bar', prefix: '/', suffix: '', pattern: '[^\\/#\\?]+?', modifier: '' }]
  const regex = Regexp(path, [], pathToRegexpOptions)
  if (process.env.NODE_ENV !== 'production') {
    const keys: any = Object.create(null)
    regex.keys.forEach(key => {
      // 重复key浸膏
      warn(
        !keys[key.name],
        `Duplicate param keys in route with path: "${path}"`
      )
      keys[key.name] = true
    })
  }
  return regex
}
// 格式化path，若为子路由，需要拼接父路由path
function normalizePath (
  path: string,
  parent?: RouteRecord,
  strict?: boolean
): string {
  if (!strict) path = path.replace(/\/$/, '') // 非严格模式，则将尾部的斜线去除
  if (path[0] === '/') return path // 只要斜线开头，无论是否子路由，直接使用
  if (parent == null) return path // 非子路由，直接返回
  return cleanPath(`${parent.path}/${path}`) // 子路由，需要拼接出完整path
}
