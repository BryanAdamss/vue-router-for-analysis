import { warn } from '../util/warn'
import { extend } from '../util/misc'

export default {
  name: 'RouterView',
  functional: true, // 函数式组件，没有this；https://cn.vuejs.org/v2/guide/render-function.html#%E5%87%BD%E6%95%B0%E5%BC%8F%E7%BB%84%E4%BB%B6
  props: {
    name: {
      type: String,
      default: 'default'
    }
  },
  // _为h即createElement，但router-view没有使用自身的h，而是使用了父节点的h
  render (/* h*/_, /* context*/{ props, children, parent, data }) {
    console.log('---parent', parent)
    // used by devtools to display a router-view badge
    data.routerView = true // 标识当前组件为router-view

    // directly use parent context's createElement() function
    // so that components rendered by router-view can resolve named slots
    const h = parent.$createElement// 使用父节点的渲染函数
    const name = props.name// 命名视图
    const route = parent.$route // 依赖父节点的$route，而在install.js中我们知道,所有组件访问到的$route其实都是_routerRoot._route，即Vue根实例上的_route；当路由被确认后，调用updateRoute时，会更新_routerRoot._route，进而导致router-view组件重新渲染
    // 缓存
    const cache = parent._routerViewCache || (parent._routerViewCache = {})

    // determine current view depth, also check to see if the tree
    // has been toggled inactive but kept-alive.
    let depth = 0 // 当前router-view嵌套深度
    let inactive = false // 是否被keep-alive包裹并处于非激活状态
    // 向上查找，计算depth、inactive
    // 当parent指向Vue根实例结束循环
    while (parent && parent._routerRoot !== parent) {
      const vnodeData = parent.$vnode ? parent.$vnode.data : {}
      if (vnodeData.routerView) {
        depth++
      }
      // 处理keep-alive
      // keep-alive组件会添加keepAlive=true标识
      // https://github.com/vuejs/vue/blob/52719ccab8fccffbdf497b96d3731dc86f04c1ce/src/core/components/keep-alive.js#L120
      if (vnodeData.keepAlive && parent._directInactive && parent._inactive) {
        inactive = true
      }
      parent = parent.$parent
    }
    data.routerViewDepth = depth

    // render previous view if the tree is inactive and kept-alive
    // 如果当前组件树被keep-alive包裹，且处于非激活状态，则渲染之前保存的视图
    if (inactive) {
      const cachedData = cache[name]
      const cachedComponent = cachedData && cachedData.component
      // 找到缓存的组件
      if (cachedComponent) {
        // #2301
        // pass props
        // 传递缓存的props
        if (cachedData.configProps) {
          fillPropsinData(cachedComponent, data, cachedData.route, cachedData.configProps)
        }
        return h(cachedComponent, data, children)
      } else {
        // 未找到缓存的组件
        // render previous empty view
        return h()
      }
    }
    // 通过depth获取匹配的route record
    // 由于formatMatch是通过unshift添加父route record的
    // 所以route.matched[depth]正好能取到匹配的route record
    const matched = route.matched[depth]
    const component = matched && matched.components[name] // 取出路由组件

    // render empty node if no matched route or no config component
    // 找不到，渲染空组件
    if (!matched || !component) {
      cache[name] = null
      return h()
    }

    // cache component
    // 缓存组件
    cache[name] = { component }

    // attach instance registration hook
    // this will be called in the instance's injected lifecycle hooks
    // 为路由记录绑定路由组件，在所有组件的beforeCreate、destoryed hook中调用，见install.js中的registerInstance方法
    // 此方法只在router-view上定义了
    // vm，val都为路由组件实例
    // 如下
    // matched.instances:{
    //   default:VueComp,
    //   hd:VueComp2,
    //   bd:VueComp3
    // }
    data.registerRouteInstance = (vm, val) => {
      // val could be undefined for unregistration
      const current = matched.instances[name]
      if (
        (val && current !== vm) || // 绑定
        (!val && current === vm) // 若val不存在，则可视为解绑
      ) {
        matched.instances[name] = val
      }
    }

    // also register instance in prepatch hook
    // in case the same component instance is reused across different routes
    // 当相同组件在不同路由间复用时，也需要为router-view绑定路由组件
    ;(data.hook || (data.hook = {})).prepatch = (_, vnode) => {
      matched.instances[name] = vnode.componentInstance
    }

    // register instance in init hook
    // in case kept-alive component be actived when routes changed
    // keep-alive组件被激活时，需要为router-view绑定路由组件
    data.hook.init = (vnode) => {
      if (vnode.data.keepAlive &&
        vnode.componentInstance &&
        vnode.componentInstance !== matched.instances[name]
      ) {
        matched.instances[name] = vnode.componentInstance
      }
    }
    // route record设置了路由传参；动态路由传参；https://router.vuejs.org/zh/guide/essentials/passing-props.
    const configProps = matched.props && matched.props[name]
    // save route and configProps in cachce
    // 如果设置了路由传参，则缓存起来，并将填充props
    if (configProps) {
      extend(cache[name], {
        route,
        configProps
      })
      fillPropsinData(component, data, route, configProps)
    }

    return h(component, data, children)
  }
}
// 填充porps
function fillPropsinData (component, data, route, configProps) {
  // resolve props
  // 解析props
  let propsToPass = data.props = resolveProps(route, configProps)
  if (propsToPass) {
    // clone to prevent mutation
    // 填充props
    propsToPass = data.props = extend({}, propsToPass)
    // pass non-declared props as attrs
    // 将未声明的props赋值给attrs
    const attrs = data.attrs = data.attrs || {}
    for (const key in propsToPass) {
      if (!component.props || !(key in component.props)) {
        attrs[key] = propsToPass[key]
        delete propsToPass[key]
      }
    }
  }
}
// 解析动态路由传参的props，动态路由传参支持多种模式(boolean、object、函数)
function resolveProps (route, config) {
  switch (typeof config) {
    case 'undefined':
      return
    case 'object':
      return config
    case 'function':
      return config(route)
    case 'boolean':
      return config ? route.params : undefined
    default:
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false,
          `props in "${route.path}" is a ${typeof config}, ` +
          `expecting an object, function or boolean.`
        )
      }
  }
}
