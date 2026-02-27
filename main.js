"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FolderCardExplorerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/settings.ts
var DEFAULT_SETTINGS = {
  sort: {
    field: "mtime",
    direction: "desc"
  },
  filter: {
    tags: []
  },
  includeSubfolders: true,
  defaultView: "cards"
};
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function normalizeSortField(value) {
  return value === "ctime" ? "ctime" : "mtime";
}
function normalizeSortDirection(value) {
  return value === "asc" ? "asc" : "desc";
}
function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((tag) => typeof tag === "string" && tag.trim().length > 0);
}
function normalizeDefaultView(value) {
  return value === "cards" ? value : DEFAULT_SETTINGS.defaultView;
}
function normalizeSettings(raw) {
  const data = isRecord(raw) ? raw : {};
  const sort = isRecord(data.sort) ? data.sort : {};
  const filter = isRecord(data.filter) ? data.filter : {};
  return {
    sort: {
      field: normalizeSortField(sort.field),
      direction: normalizeSortDirection(sort.direction)
    },
    filter: {
      tags: normalizeTags(filter.tags)
    },
    includeSubfolders: typeof data.includeSubfolders === "boolean" ? data.includeSubfolders : DEFAULT_SETTINGS.includeSubfolders,
    defaultView: normalizeDefaultView(data.defaultView)
  };
}
function mergeSettings(current, patch) {
  var _a, _b;
  return normalizeSettings({
    ...current,
    ...patch,
    sort: {
      ...current.sort,
      ...(_a = patch.sort) != null ? _a : {}
    },
    filter: {
      ...current.filter,
      ...(_b = patch.filter) != null ? _b : {}
    }
  });
}

// src/view/FolderCardView.ts
var import_obsidian2 = require("obsidian");

// node_modules/svelte/src/runtime/internal/utils.js
function noop() {
}
function run(fn) {
  return fn();
}
function blank_object() {
  return /* @__PURE__ */ Object.create(null);
}
function run_all(fns) {
  fns.forEach(run);
}
function is_function(thing) {
  return typeof thing === "function";
}
function safe_not_equal(a, b) {
  return a != a ? b == b : a !== b || a && typeof a === "object" || typeof a === "function";
}
function is_empty(obj) {
  return Object.keys(obj).length === 0;
}
function action_destroyer(action_result) {
  return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
}

// node_modules/svelte/src/runtime/internal/globals.js
var globals = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : (
  // @ts-ignore Node typings have this
  global
);

// node_modules/svelte/src/runtime/internal/ResizeObserverSingleton.js
var ResizeObserverSingleton = class _ResizeObserverSingleton {
  /** @param {ResizeObserverOptions} options */
  constructor(options) {
    /**
     * @private
     * @readonly
     * @type {WeakMap<Element, import('./private.js').Listener>}
     */
    __publicField(this, "_listeners", "WeakMap" in globals ? /* @__PURE__ */ new WeakMap() : void 0);
    /**
     * @private
     * @type {ResizeObserver}
     */
    __publicField(this, "_observer");
    /** @type {ResizeObserverOptions} */
    __publicField(this, "options");
    this.options = options;
  }
  /**
   * @param {Element} element
   * @param {import('./private.js').Listener} listener
   * @returns {() => void}
   */
  observe(element2, listener) {
    this._listeners.set(element2, listener);
    this._getObserver().observe(element2, this.options);
    return () => {
      this._listeners.delete(element2);
      this._observer.unobserve(element2);
    };
  }
  /**
   * @private
   */
  _getObserver() {
    var _a;
    return (_a = this._observer) != null ? _a : this._observer = new ResizeObserver((entries) => {
      var _a2;
      for (const entry of entries) {
        _ResizeObserverSingleton.entries.set(entry.target, entry);
        (_a2 = this._listeners.get(entry.target)) == null ? void 0 : _a2(entry);
      }
    });
  }
};
ResizeObserverSingleton.entries = "WeakMap" in globals ? /* @__PURE__ */ new WeakMap() : void 0;

// node_modules/svelte/src/runtime/internal/dom.js
var is_hydrating = false;
function start_hydrating() {
  is_hydrating = true;
}
function end_hydrating() {
  is_hydrating = false;
}
function append(target, node) {
  target.appendChild(node);
}
function insert(target, node, anchor) {
  target.insertBefore(node, anchor || null);
}
function detach(node) {
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
}
function destroy_each(iterations, detaching) {
  for (let i = 0; i < iterations.length; i += 1) {
    if (iterations[i]) iterations[i].d(detaching);
  }
}
function element(name) {
  return document.createElement(name);
}
function svg_element(name) {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}
function text(data) {
  return document.createTextNode(data);
}
function space() {
  return text(" ");
}
function empty() {
  return text("");
}
function listen(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
  if (value == null) node.removeAttribute(attribute);
  else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
}
function children(element2) {
  return Array.from(element2.childNodes);
}
function set_data(text2, data) {
  data = "" + data;
  if (text2.data === data) return;
  text2.data = /** @type {string} */
  data;
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
  return new CustomEvent(type, { detail, bubbles, cancelable });
}
var HtmlTag = class {
  constructor(is_svg = false) {
    /**
     * @private
     * @default false
     */
    __publicField(this, "is_svg", false);
    /** parent for creating node */
    __publicField(this, "e");
    /** html tag nodes */
    __publicField(this, "n");
    /** target */
    __publicField(this, "t");
    /** anchor */
    __publicField(this, "a");
    this.is_svg = is_svg;
    this.e = this.n = null;
  }
  /**
   * @param {string} html
   * @returns {void}
   */
  c(html) {
    this.h(html);
  }
  /**
   * @param {string} html
   * @param {HTMLElement | SVGElement} target
   * @param {HTMLElement | SVGElement} anchor
   * @returns {void}
   */
  m(html, target, anchor = null) {
    if (!this.e) {
      if (this.is_svg)
        this.e = svg_element(
          /** @type {keyof SVGElementTagNameMap} */
          target.nodeName
        );
      else
        this.e = element(
          /** @type {keyof HTMLElementTagNameMap} */
          target.nodeType === 11 ? "TEMPLATE" : target.nodeName
        );
      this.t = target.tagName !== "TEMPLATE" ? target : (
        /** @type {HTMLTemplateElement} */
        target.content
      );
      this.c(html);
    }
    this.i(anchor);
  }
  /**
   * @param {string} html
   * @returns {void}
   */
  h(html) {
    this.e.innerHTML = html;
    this.n = Array.from(
      this.e.nodeName === "TEMPLATE" ? this.e.content.childNodes : this.e.childNodes
    );
  }
  /**
   * @returns {void} */
  i(anchor) {
    for (let i = 0; i < this.n.length; i += 1) {
      insert(this.t, this.n[i], anchor);
    }
  }
  /**
   * @param {string} html
   * @returns {void}
   */
  p(html) {
    this.d();
    this.h(html);
    this.i(this.a);
  }
  /**
   * @returns {void} */
  d() {
    this.n.forEach(detach);
  }
};
function get_custom_elements_slots(element2) {
  const result = {};
  element2.childNodes.forEach(
    /** @param {Element} node */
    (node) => {
      result[node.slot || "default"] = true;
    }
  );
  return result;
}

// node_modules/svelte/src/runtime/internal/lifecycle.js
var current_component;
function set_current_component(component) {
  current_component = component;
}
function get_current_component() {
  if (!current_component) throw new Error("Function called outside component initialization");
  return current_component;
}
function createEventDispatcher() {
  const component = get_current_component();
  return (type, detail, { cancelable = false } = {}) => {
    const callbacks = component.$$.callbacks[type];
    if (callbacks) {
      const event = custom_event(
        /** @type {string} */
        type,
        detail,
        { cancelable }
      );
      callbacks.slice().forEach((fn) => {
        fn.call(component, event);
      });
      return !event.defaultPrevented;
    }
    return true;
  };
}

// node_modules/svelte/src/runtime/internal/scheduler.js
var dirty_components = [];
var binding_callbacks = [];
var render_callbacks = [];
var flush_callbacks = [];
var resolved_promise = /* @__PURE__ */ Promise.resolve();
var update_scheduled = false;
function schedule_update() {
  if (!update_scheduled) {
    update_scheduled = true;
    resolved_promise.then(flush);
  }
}
function add_render_callback(fn) {
  render_callbacks.push(fn);
}
var seen_callbacks = /* @__PURE__ */ new Set();
var flushidx = 0;
function flush() {
  if (flushidx !== 0) {
    return;
  }
  const saved_component = current_component;
  do {
    try {
      while (flushidx < dirty_components.length) {
        const component = dirty_components[flushidx];
        flushidx++;
        set_current_component(component);
        update(component.$$);
      }
    } catch (e) {
      dirty_components.length = 0;
      flushidx = 0;
      throw e;
    }
    set_current_component(null);
    dirty_components.length = 0;
    flushidx = 0;
    while (binding_callbacks.length) binding_callbacks.pop()();
    for (let i = 0; i < render_callbacks.length; i += 1) {
      const callback = render_callbacks[i];
      if (!seen_callbacks.has(callback)) {
        seen_callbacks.add(callback);
        callback();
      }
    }
    render_callbacks.length = 0;
  } while (dirty_components.length);
  while (flush_callbacks.length) {
    flush_callbacks.pop()();
  }
  update_scheduled = false;
  seen_callbacks.clear();
  set_current_component(saved_component);
}
function update($$) {
  if ($$.fragment !== null) {
    $$.update();
    run_all($$.before_update);
    const dirty = $$.dirty;
    $$.dirty = [-1];
    $$.fragment && $$.fragment.p($$.ctx, dirty);
    $$.after_update.forEach(add_render_callback);
  }
}
function flush_render_callbacks(fns) {
  const filtered = [];
  const targets = [];
  render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
  targets.forEach((c) => c());
  render_callbacks = filtered;
}

// node_modules/svelte/src/runtime/internal/transitions.js
var outroing = /* @__PURE__ */ new Set();
function transition_in(block, local) {
  if (block && block.i) {
    outroing.delete(block);
    block.i(local);
  }
}

// node_modules/svelte/src/runtime/internal/each.js
function ensure_array_like(array_like_or_iterator) {
  return (array_like_or_iterator == null ? void 0 : array_like_or_iterator.length) !== void 0 ? array_like_or_iterator : Array.from(array_like_or_iterator);
}

// node_modules/svelte/src/shared/boolean_attributes.js
var _boolean_attributes = (
  /** @type {const} */
  [
    "allowfullscreen",
    "allowpaymentrequest",
    "async",
    "autofocus",
    "autoplay",
    "checked",
    "controls",
    "default",
    "defer",
    "disabled",
    "formnovalidate",
    "hidden",
    "inert",
    "ismap",
    "loop",
    "multiple",
    "muted",
    "nomodule",
    "novalidate",
    "open",
    "playsinline",
    "readonly",
    "required",
    "reversed",
    "selected"
  ]
);
var boolean_attributes = /* @__PURE__ */ new Set([..._boolean_attributes]);

// node_modules/svelte/src/runtime/internal/Component.js
function mount_component(component, target, anchor) {
  const { fragment, after_update } = component.$$;
  fragment && fragment.m(target, anchor);
  add_render_callback(() => {
    const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
    if (component.$$.on_destroy) {
      component.$$.on_destroy.push(...new_on_destroy);
    } else {
      run_all(new_on_destroy);
    }
    component.$$.on_mount = [];
  });
  after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
  const $$ = component.$$;
  if ($$.fragment !== null) {
    flush_render_callbacks($$.after_update);
    run_all($$.on_destroy);
    $$.fragment && $$.fragment.d(detaching);
    $$.on_destroy = $$.fragment = null;
    $$.ctx = [];
  }
}
function make_dirty(component, i) {
  if (component.$$.dirty[0] === -1) {
    dirty_components.push(component);
    schedule_update();
    component.$$.dirty.fill(0);
  }
  component.$$.dirty[i / 31 | 0] |= 1 << i % 31;
}
function init(component, options, instance2, create_fragment2, not_equal, props, append_styles = null, dirty = [-1]) {
  const parent_component = current_component;
  set_current_component(component);
  const $$ = component.$$ = {
    fragment: null,
    ctx: [],
    // state
    props,
    update: noop,
    not_equal,
    bound: blank_object(),
    // lifecycle
    on_mount: [],
    on_destroy: [],
    on_disconnect: [],
    before_update: [],
    after_update: [],
    context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
    // everything else
    callbacks: blank_object(),
    dirty,
    skip_bound: false,
    root: options.target || parent_component.$$.root
  };
  append_styles && append_styles($$.root);
  let ready = false;
  $$.ctx = instance2 ? instance2(component, options.props || {}, (i, ret, ...rest) => {
    const value = rest.length ? rest[0] : ret;
    if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
      if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
      if (ready) make_dirty(component, i);
    }
    return ret;
  }) : [];
  $$.update();
  ready = true;
  run_all($$.before_update);
  $$.fragment = create_fragment2 ? create_fragment2($$.ctx) : false;
  if (options.target) {
    if (options.hydrate) {
      start_hydrating();
      const nodes = children(options.target);
      $$.fragment && $$.fragment.l(nodes);
      nodes.forEach(detach);
    } else {
      $$.fragment && $$.fragment.c();
    }
    if (options.intro) transition_in(component.$$.fragment);
    mount_component(component, options.target, options.anchor);
    end_hydrating();
    flush();
  }
  set_current_component(parent_component);
}
var SvelteElement;
if (typeof HTMLElement === "function") {
  SvelteElement = class extends HTMLElement {
    constructor($$componentCtor, $$slots, use_shadow_dom) {
      super();
      /** The Svelte component constructor */
      __publicField(this, "$$ctor");
      /** Slots */
      __publicField(this, "$$s");
      /** The Svelte component instance */
      __publicField(this, "$$c");
      /** Whether or not the custom element is connected */
      __publicField(this, "$$cn", false);
      /** Component props data */
      __publicField(this, "$$d", {});
      /** `true` if currently in the process of reflecting component props back to attributes */
      __publicField(this, "$$r", false);
      /** @type {Record<string, CustomElementPropDefinition>} Props definition (name, reflected, type etc) */
      __publicField(this, "$$p_d", {});
      /** @type {Record<string, Function[]>} Event listeners */
      __publicField(this, "$$l", {});
      /** @type {Map<Function, Function>} Event listener unsubscribe functions */
      __publicField(this, "$$l_u", /* @__PURE__ */ new Map());
      this.$$ctor = $$componentCtor;
      this.$$s = $$slots;
      if (use_shadow_dom) {
        this.attachShadow({ mode: "open" });
      }
    }
    addEventListener(type, listener, options) {
      this.$$l[type] = this.$$l[type] || [];
      this.$$l[type].push(listener);
      if (this.$$c) {
        const unsub = this.$$c.$on(type, listener);
        this.$$l_u.set(listener, unsub);
      }
      super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, options);
      if (this.$$c) {
        const unsub = this.$$l_u.get(listener);
        if (unsub) {
          unsub();
          this.$$l_u.delete(listener);
        }
      }
      if (this.$$l[type]) {
        const idx = this.$$l[type].indexOf(listener);
        if (idx >= 0) {
          this.$$l[type].splice(idx, 1);
        }
      }
    }
    async connectedCallback() {
      this.$$cn = true;
      if (!this.$$c) {
        let create_slot = function(name) {
          return () => {
            let node;
            const obj = {
              c: function create() {
                node = element("slot");
                if (name !== "default") {
                  attr(node, "name", name);
                }
              },
              /**
               * @param {HTMLElement} target
               * @param {HTMLElement} [anchor]
               */
              m: function mount(target, anchor) {
                insert(target, node, anchor);
              },
              d: function destroy(detaching) {
                if (detaching) {
                  detach(node);
                }
              }
            };
            return obj;
          };
        };
        await Promise.resolve();
        if (!this.$$cn || this.$$c) {
          return;
        }
        const $$slots = {};
        const existing_slots = get_custom_elements_slots(this);
        for (const name of this.$$s) {
          if (name in existing_slots) {
            $$slots[name] = [create_slot(name)];
          }
        }
        for (const attribute of this.attributes) {
          const name = this.$$g_p(attribute.name);
          if (!(name in this.$$d)) {
            this.$$d[name] = get_custom_element_value(name, attribute.value, this.$$p_d, "toProp");
          }
        }
        for (const key in this.$$p_d) {
          if (!(key in this.$$d) && this[key] !== void 0) {
            this.$$d[key] = this[key];
            delete this[key];
          }
        }
        this.$$c = new this.$$ctor({
          target: this.shadowRoot || this,
          props: {
            ...this.$$d,
            $$slots,
            $$scope: {
              ctx: []
            }
          }
        });
        const reflect_attributes = () => {
          this.$$r = true;
          for (const key in this.$$p_d) {
            this.$$d[key] = this.$$c.$$.ctx[this.$$c.$$.props[key]];
            if (this.$$p_d[key].reflect) {
              const attribute_value = get_custom_element_value(
                key,
                this.$$d[key],
                this.$$p_d,
                "toAttribute"
              );
              if (attribute_value == null) {
                this.removeAttribute(this.$$p_d[key].attribute || key);
              } else {
                this.setAttribute(this.$$p_d[key].attribute || key, attribute_value);
              }
            }
          }
          this.$$r = false;
        };
        this.$$c.$$.after_update.push(reflect_attributes);
        reflect_attributes();
        for (const type in this.$$l) {
          for (const listener of this.$$l[type]) {
            const unsub = this.$$c.$on(type, listener);
            this.$$l_u.set(listener, unsub);
          }
        }
        this.$$l = {};
      }
    }
    // We don't need this when working within Svelte code, but for compatibility of people using this outside of Svelte
    // and setting attributes through setAttribute etc, this is helpful
    attributeChangedCallback(attr2, _oldValue, newValue) {
      var _a;
      if (this.$$r) return;
      attr2 = this.$$g_p(attr2);
      this.$$d[attr2] = get_custom_element_value(attr2, newValue, this.$$p_d, "toProp");
      (_a = this.$$c) == null ? void 0 : _a.$set({ [attr2]: this.$$d[attr2] });
    }
    disconnectedCallback() {
      this.$$cn = false;
      Promise.resolve().then(() => {
        if (!this.$$cn && this.$$c) {
          this.$$c.$destroy();
          this.$$c = void 0;
        }
      });
    }
    $$g_p(attribute_name) {
      return Object.keys(this.$$p_d).find(
        (key) => this.$$p_d[key].attribute === attribute_name || !this.$$p_d[key].attribute && key.toLowerCase() === attribute_name
      ) || attribute_name;
    }
  };
}
function get_custom_element_value(prop, value, props_definition, transform) {
  var _a;
  const type = (_a = props_definition[prop]) == null ? void 0 : _a.type;
  value = type === "Boolean" && typeof value !== "boolean" ? value != null : value;
  if (!transform || !props_definition[prop]) {
    return value;
  } else if (transform === "toAttribute") {
    switch (type) {
      case "Object":
      case "Array":
        return value == null ? null : JSON.stringify(value);
      case "Boolean":
        return value ? "" : null;
      case "Number":
        return value == null ? null : value;
      default:
        return value;
    }
  } else {
    switch (type) {
      case "Object":
      case "Array":
        return value && JSON.parse(value);
      case "Boolean":
        return value;
      // conversion already handled above
      case "Number":
        return value != null ? +value : value;
      default:
        return value;
    }
  }
}
var SvelteComponent = class {
  constructor() {
    /**
     * ### PRIVATE API
     *
     * Do not use, may change at any time
     *
     * @type {any}
     */
    __publicField(this, "$$");
    /**
     * ### PRIVATE API
     *
     * Do not use, may change at any time
     *
     * @type {any}
     */
    __publicField(this, "$$set");
  }
  /** @returns {void} */
  $destroy() {
    destroy_component(this, 1);
    this.$destroy = noop;
  }
  /**
   * @template {Extract<keyof Events, string>} K
   * @param {K} type
   * @param {((e: Events[K]) => void) | null | undefined} callback
   * @returns {() => void}
   */
  $on(type, callback) {
    if (!is_function(callback)) {
      return noop;
    }
    const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
    callbacks.push(callback);
    return () => {
      const index = callbacks.indexOf(callback);
      if (index !== -1) callbacks.splice(index, 1);
    };
  }
  /**
   * @param {Partial<Props>} props
   * @returns {void}
   */
  $set(props) {
    if (this.$$set && !is_empty(props)) {
      this.$$.skip_bound = true;
      this.$$set(props);
      this.$$.skip_bound = false;
    }
  }
};

// node_modules/svelte/src/shared/version.js
var PUBLIC_VERSION = "4";

// node_modules/svelte/src/runtime/internal/disclose-version/index.js
if (typeof window !== "undefined")
  (window.__svelte || (window.__svelte = { v: /* @__PURE__ */ new Set() })).v.add(PUBLIC_VERSION);

// src/view/FolderCardPanel.svelte
var import_obsidian = require("obsidian");
function get_each_context(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[36] = list[i];
  child_ctx[38] = i;
  return child_ctx;
}
function get_each_context_1(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[39] = list[i];
  return child_ctx;
}
function create_each_block_1(ctx) {
  let button;
  let span;
  let t1;
  let button_class_value;
  let button_aria_label_value;
  let applyIcon_action;
  let mounted;
  let dispose;
  function click_handler() {
    return (
      /*click_handler*/
      ctx[31](
        /*action*/
        ctx[39]
      )
    );
  }
  return {
    c() {
      button = element("button");
      span = element("span");
      span.textContent = `${/*action*/
      ctx[39].label}`;
      t1 = space();
      attr(span, "class", "fce-sr-only");
      attr(button, "type", "button");
      attr(button, "class", button_class_value = "clickable-icon fce-toolbar-button " + /*activeToolbarAction*/
      (ctx[4] === /*action*/
      ctx[39].id ? "is-selected" : ""));
      attr(button, "aria-label", button_aria_label_value = /*action*/
      ctx[39].title);
    },
    m(target, anchor) {
      insert(target, button, anchor);
      append(button, span);
      append(button, t1);
      if (!mounted) {
        dispose = [
          listen(button, "click", click_handler),
          action_destroyer(applyIcon_action = /*applyIcon*/
          ctx[15].call(
            null,
            button,
            /*action*/
            ctx[39].icon
          ))
        ];
        mounted = true;
      }
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      if (dirty[0] & /*activeToolbarAction*/
      16 && button_class_value !== (button_class_value = "clickable-icon fce-toolbar-button " + /*activeToolbarAction*/
      (ctx[4] === /*action*/
      ctx[39].id ? "is-selected" : ""))) {
        attr(button, "class", button_class_value);
      }
    },
    d(detaching) {
      if (detaching) {
        detach(button);
      }
      mounted = false;
      run_all(dispose);
    }
  };
}
function create_else_block_3(ctx) {
  let p;
  return {
    c() {
      p = element("p");
      p.textContent = "Click a folder in File Explorer to preview notes.";
      attr(p, "class", "fce-folder");
    },
    m(target, anchor) {
      insert(target, p, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(p);
      }
    }
  };
}
function create_if_block_4(ctx) {
  let p0;
  let t0;
  let t1;
  let p1;
  let t2_value = (
    /*cards*/
    ctx[0].length + ""
  );
  let t2;
  let t3;
  return {
    c() {
      p0 = element("p");
      t0 = text(
        /*folderPath*/
        ctx[1]
      );
      t1 = space();
      p1 = element("p");
      t2 = text(t2_value);
      t3 = text(" notes");
      attr(p0, "class", "fce-folder");
      attr(p1, "class", "fce-count");
    },
    m(target, anchor) {
      insert(target, p0, anchor);
      append(p0, t0);
      insert(target, t1, anchor);
      insert(target, p1, anchor);
      append(p1, t2);
      append(p1, t3);
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*folderPath*/
      2) set_data(
        t0,
        /*folderPath*/
        ctx2[1]
      );
      if (dirty[0] & /*cards*/
      1 && t2_value !== (t2_value = /*cards*/
      ctx2[0].length + "")) set_data(t2, t2_value);
    },
    d(detaching) {
      if (detaching) {
        detach(p0);
        detach(t1);
        detach(p1);
      }
    }
  };
}
function create_else_block(ctx) {
  let div0;
  let div0_style_value;
  let t0;
  let t1;
  let div1;
  let div1_style_value;
  let each_value = ensure_array_like(
    /*visibleCards*/
    ctx[9]
  );
  let each_blocks = [];
  for (let i = 0; i < each_value.length; i += 1) {
    each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
  }
  return {
    c() {
      div0 = element("div");
      t0 = space();
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      t1 = space();
      div1 = element("div");
      attr(div0, "style", div0_style_value = `height: ${/*topPadding*/
      ctx[11]}px;`);
      attr(div1, "style", div1_style_value = `height: ${/*bottomPadding*/
      ctx[10]}px;`);
    },
    m(target, anchor) {
      insert(target, div0, anchor);
      insert(target, t0, anchor);
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(target, anchor);
        }
      }
      insert(target, t1, anchor);
      insert(target, div1, anchor);
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*topPadding*/
      2048 && div0_style_value !== (div0_style_value = `height: ${/*topPadding*/
      ctx2[11]}px;`)) {
        attr(div0, "style", div0_style_value);
      }
      if (dirty[0] & /*selectedPath, visibleCards, startIndex, openNote, onCardKeydown*/
      279076) {
        each_value = ensure_array_like(
          /*visibleCards*/
          ctx2[9]
        );
        let i;
        for (i = 0; i < each_value.length; i += 1) {
          const child_ctx = get_each_context(ctx2, each_value, i);
          if (each_blocks[i]) {
            each_blocks[i].p(child_ctx, dirty);
          } else {
            each_blocks[i] = create_each_block(child_ctx);
            each_blocks[i].c();
            each_blocks[i].m(t1.parentNode, t1);
          }
        }
        for (; i < each_blocks.length; i += 1) {
          each_blocks[i].d(1);
        }
        each_blocks.length = each_value.length;
      }
      if (dirty[0] & /*bottomPadding*/
      1024 && div1_style_value !== (div1_style_value = `height: ${/*bottomPadding*/
      ctx2[10]}px;`)) {
        attr(div1, "style", div1_style_value);
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div0);
        detach(t0);
        detach(t1);
        detach(div1);
      }
      destroy_each(each_blocks, detaching);
    }
  };
}
function create_if_block_1(ctx) {
  let div;
  return {
    c() {
      div = element("div");
      div.textContent = "No Markdown notes found in this folder.";
      attr(div, "class", "fce-empty");
    },
    m(target, anchor) {
      insert(target, div, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(div);
      }
    }
  };
}
function create_if_block(ctx) {
  let div;
  return {
    c() {
      div = element("div");
      div.textContent = "Loading folder cards...";
      attr(div, "class", "fce-empty");
    },
    m(target, anchor) {
      insert(target, div, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(div);
      }
    }
  };
}
function create_else_block_2(ctx) {
  let p;
  return {
    c() {
      p = element("p");
      p.textContent = "Loading preview...";
      attr(p, "class", "fce-preview-empty");
    },
    m(target, anchor) {
      insert(target, p, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(p);
      }
    }
  };
}
function create_if_block_2(ctx) {
  let if_block_anchor;
  function select_block_type_3(ctx2, dirty) {
    if (
      /*card*/
      ctx2[36].previewMode === "empty" || !/*card*/
      ctx2[36].previewHtml
    ) return create_if_block_3;
    return create_else_block_1;
  }
  let current_block_type = select_block_type_3(ctx, [-1, -1]);
  let if_block = current_block_type(ctx);
  return {
    c() {
      if_block.c();
      if_block_anchor = empty();
    },
    m(target, anchor) {
      if_block.m(target, anchor);
      insert(target, if_block_anchor, anchor);
    },
    p(ctx2, dirty) {
      if (current_block_type === (current_block_type = select_block_type_3(ctx2, dirty)) && if_block) {
        if_block.p(ctx2, dirty);
      } else {
        if_block.d(1);
        if_block = current_block_type(ctx2);
        if (if_block) {
          if_block.c();
          if_block.m(if_block_anchor.parentNode, if_block_anchor);
        }
      }
    },
    d(detaching) {
      if (detaching) {
        detach(if_block_anchor);
      }
      if_block.d(detaching);
    }
  };
}
function create_else_block_1(ctx) {
  let html_tag;
  let raw_value = (
    /*card*/
    ctx[36].previewHtml + ""
  );
  let html_anchor;
  return {
    c() {
      html_tag = new HtmlTag(false);
      html_anchor = empty();
      html_tag.a = html_anchor;
    },
    m(target, anchor) {
      html_tag.m(raw_value, target, anchor);
      insert(target, html_anchor, anchor);
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*visibleCards*/
      512 && raw_value !== (raw_value = /*card*/
      ctx2[36].previewHtml + "")) html_tag.p(raw_value);
    },
    d(detaching) {
      if (detaching) {
        detach(html_anchor);
        html_tag.d();
      }
    }
  };
}
function create_if_block_3(ctx) {
  let p;
  return {
    c() {
      p = element("p");
      p.textContent = "No previewable text near the top.";
      attr(p, "class", "fce-preview-empty");
    },
    m(target, anchor) {
      insert(target, p, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(p);
      }
    }
  };
}
function create_each_block(ctx) {
  let div2;
  let div1;
  let h4;
  let t0_value = (
    /*card*/
    ctx[36].title + ""
  );
  let t0;
  let t1;
  let div0;
  let div0_class_value;
  let t2;
  let p;
  let t3;
  let t4_value = formatDate(
    /*card*/
    ctx[36].mtime
  ) + "";
  let t4;
  let t5;
  let t6_value = formatDate(
    /*card*/
    ctx[36].ctime
  ) + "";
  let t6;
  let div2_class_value;
  let measureHeight_action;
  let mounted;
  let dispose;
  function select_block_type_2(ctx2, dirty) {
    if (
      /*card*/
      ctx2[36].hydrated
    ) return create_if_block_2;
    return create_else_block_2;
  }
  let current_block_type = select_block_type_2(ctx, [-1, -1]);
  let if_block = current_block_type(ctx);
  function click_handler_1() {
    return (
      /*click_handler_1*/
      ctx[32](
        /*card*/
        ctx[36]
      )
    );
  }
  function keydown_handler(...args) {
    return (
      /*keydown_handler*/
      ctx[33](
        /*card*/
        ctx[36],
        ...args
      )
    );
  }
  return {
    c() {
      div2 = element("div");
      div1 = element("div");
      h4 = element("h4");
      t0 = text(t0_value);
      t1 = space();
      div0 = element("div");
      if_block.c();
      t2 = space();
      p = element("p");
      t3 = text("Modified ");
      t4 = text(t4_value);
      t5 = text(" \xB7 Created ");
      t6 = text(t6_value);
      attr(div0, "class", div0_class_value = "fce-excerpt " + /*card*/
      (ctx[36].previewMode === "code" ? "is-code" : ""));
      attr(p, "class", "fce-meta");
      attr(div1, "class", "fce-card-body");
      attr(div2, "class", div2_class_value = "fce-card " + /*selectedPath*/
      (ctx[2] === /*card*/
      ctx[36].path ? "is-selected" : ""));
      attr(div2, "role", "button");
      attr(div2, "tabindex", "0");
    },
    m(target, anchor) {
      insert(target, div2, anchor);
      append(div2, div1);
      append(div1, h4);
      append(h4, t0);
      append(div1, t1);
      append(div1, div0);
      if_block.m(div0, null);
      append(div1, t2);
      append(div1, p);
      append(p, t3);
      append(p, t4);
      append(p, t5);
      append(p, t6);
      if (!mounted) {
        dispose = [
          listen(div2, "click", click_handler_1),
          listen(div2, "keydown", keydown_handler),
          action_destroyer(measureHeight_action = /*measureHeight*/
          ctx[16].call(
            null,
            div2,
            /*startIndex*/
            ctx[5] + /*i*/
            ctx[38]
          ))
        ];
        mounted = true;
      }
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      if (dirty[0] & /*visibleCards*/
      512 && t0_value !== (t0_value = /*card*/
      ctx[36].title + "")) set_data(t0, t0_value);
      if (current_block_type === (current_block_type = select_block_type_2(ctx, dirty)) && if_block) {
        if_block.p(ctx, dirty);
      } else {
        if_block.d(1);
        if_block = current_block_type(ctx);
        if (if_block) {
          if_block.c();
          if_block.m(div0, null);
        }
      }
      if (dirty[0] & /*visibleCards*/
      512 && div0_class_value !== (div0_class_value = "fce-excerpt " + /*card*/
      (ctx[36].previewMode === "code" ? "is-code" : ""))) {
        attr(div0, "class", div0_class_value);
      }
      if (dirty[0] & /*visibleCards*/
      512 && t4_value !== (t4_value = formatDate(
        /*card*/
        ctx[36].mtime
      ) + "")) set_data(t4, t4_value);
      if (dirty[0] & /*visibleCards*/
      512 && t6_value !== (t6_value = formatDate(
        /*card*/
        ctx[36].ctime
      ) + "")) set_data(t6, t6_value);
      if (dirty[0] & /*selectedPath, visibleCards*/
      516 && div2_class_value !== (div2_class_value = "fce-card " + /*selectedPath*/
      (ctx[2] === /*card*/
      ctx[36].path ? "is-selected" : ""))) {
        attr(div2, "class", div2_class_value);
      }
      if (measureHeight_action && is_function(measureHeight_action.update) && dirty[0] & /*startIndex*/
      32) measureHeight_action.update.call(
        null,
        /*startIndex*/
        ctx[5] + /*i*/
        ctx[38]
      );
    },
    d(detaching) {
      if (detaching) {
        detach(div2);
      }
      if_block.d();
      mounted = false;
      run_all(dispose);
    }
  };
}
function create_fragment(ctx) {
  let div4;
  let header;
  let div1;
  let div0;
  let t0;
  let div2;
  let p0;
  let t1_value = (
    /*activeToolbarConfig*/
    ctx[6].title + ""
  );
  let t1;
  let t2;
  let p1;
  let t3;
  let t4;
  let t5;
  let div3;
  let mounted;
  let dispose;
  let each_value_1 = ensure_array_like(
    /*TOOLBAR_ACTIONS*/
    ctx[12]
  );
  let each_blocks = [];
  for (let i = 0; i < each_value_1.length; i += 1) {
    each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
  }
  function select_block_type(ctx2, dirty) {
    if (
      /*folderPath*/
      ctx2[1]
    ) return create_if_block_4;
    return create_else_block_3;
  }
  let current_block_type = select_block_type(ctx, [-1, -1]);
  let if_block0 = current_block_type(ctx);
  function select_block_type_1(ctx2, dirty) {
    if (
      /*loading*/
      ctx2[3]
    ) return create_if_block;
    if (
      /*cards*/
      ctx2[0].length === 0
    ) return create_if_block_1;
    return create_else_block;
  }
  let current_block_type_1 = select_block_type_1(ctx, [-1, -1]);
  let if_block1 = current_block_type_1(ctx);
  return {
    c() {
      div4 = element("div");
      header = element("header");
      div1 = element("div");
      div0 = element("div");
      for (let i = 0; i < each_blocks.length; i += 1) {
        each_blocks[i].c();
      }
      t0 = space();
      div2 = element("div");
      p0 = element("p");
      t1 = text(t1_value);
      t2 = space();
      p1 = element("p");
      t3 = text(
        /*activeToolbarDescription*/
        ctx[8]
      );
      t4 = space();
      if_block0.c();
      t5 = space();
      div3 = element("div");
      if_block1.c();
      attr(div0, "class", "fce-toolbar-buttons");
      attr(div1, "class", "fce-toolbar");
      attr(div1, "role", "toolbar");
      attr(div1, "aria-label", "Folder card actions");
      attr(p0, "class", "fce-toolbar-title");
      attr(p1, "class", "fce-toolbar-description");
      attr(div2, "class", "fce-toolbar-content");
      attr(header, "class", "fce-header");
      attr(div3, "class", "fce-list");
      attr(div4, "class", "fce-shell");
    },
    m(target, anchor) {
      insert(target, div4, anchor);
      append(div4, header);
      append(header, div1);
      append(div1, div0);
      for (let i = 0; i < each_blocks.length; i += 1) {
        if (each_blocks[i]) {
          each_blocks[i].m(div0, null);
        }
      }
      append(header, t0);
      append(header, div2);
      append(div2, p0);
      append(p0, t1);
      append(div2, t2);
      append(div2, p1);
      append(p1, t3);
      append(div2, t4);
      if_block0.m(div2, null);
      append(div4, t5);
      append(div4, div3);
      if_block1.m(div3, null);
      ctx[34](div3);
      if (!mounted) {
        dispose = listen(
          div3,
          "scroll",
          /*onScroll*/
          ctx[13]
        );
        mounted = true;
      }
    },
    p(ctx2, dirty) {
      if (dirty[0] & /*activeToolbarAction, TOOLBAR_ACTIONS, selectToolbarAction*/
      135184) {
        each_value_1 = ensure_array_like(
          /*TOOLBAR_ACTIONS*/
          ctx2[12]
        );
        let i;
        for (i = 0; i < each_value_1.length; i += 1) {
          const child_ctx = get_each_context_1(ctx2, each_value_1, i);
          if (each_blocks[i]) {
            each_blocks[i].p(child_ctx, dirty);
          } else {
            each_blocks[i] = create_each_block_1(child_ctx);
            each_blocks[i].c();
            each_blocks[i].m(div0, null);
          }
        }
        for (; i < each_blocks.length; i += 1) {
          each_blocks[i].d(1);
        }
        each_blocks.length = each_value_1.length;
      }
      if (dirty[0] & /*activeToolbarConfig*/
      64 && t1_value !== (t1_value = /*activeToolbarConfig*/
      ctx2[6].title + "")) set_data(t1, t1_value);
      if (dirty[0] & /*activeToolbarDescription*/
      256) set_data(
        t3,
        /*activeToolbarDescription*/
        ctx2[8]
      );
      if (current_block_type === (current_block_type = select_block_type(ctx2, dirty)) && if_block0) {
        if_block0.p(ctx2, dirty);
      } else {
        if_block0.d(1);
        if_block0 = current_block_type(ctx2);
        if (if_block0) {
          if_block0.c();
          if_block0.m(div2, null);
        }
      }
      if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx2, dirty)) && if_block1) {
        if_block1.p(ctx2, dirty);
      } else {
        if_block1.d(1);
        if_block1 = current_block_type_1(ctx2);
        if (if_block1) {
          if_block1.c();
          if_block1.m(div3, null);
        }
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(div4);
      }
      destroy_each(each_blocks, detaching);
      if_block0.d();
      if_block1.d();
      ctx[34](null);
      mounted = false;
      dispose();
    }
  };
}
var ESTIMATED_CARD_HEIGHT = 220;
var OVERSCAN = 5;
function findStartIndex(scrollTopValue, posArray) {
  if (posArray.length === 0) return 0;
  let low = 0;
  let high = posArray.length - 1;
  let match = 0;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    if (posArray[mid] <= scrollTopValue) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return match;
}
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}
function describeToolbarAction(actionId, currentFolderPath) {
  if (actionId === "pick-folder") {
    return currentFolderPath ? "Current folder can be changed from File Explorer." : "Click a folder in File Explorer to load cards.";
  }
  if (actionId === "new-note") {
    return currentFolderPath ? "Create note action will be mounted here in next tasks." : "Select a folder first, then create note in place.";
  }
  if (actionId === "sort") {
    return "Sort controls will be mounted here.";
  }
  if (actionId === "filter") {
    return "Filter controls will be mounted here.";
  }
  return "Bulk selection actions will be mounted here.";
}
function instance($$self, $$props, $$invalidate) {
  let baseStartIndex;
  let baseEndIndex;
  let startIndex;
  let endIndex;
  let topPadding;
  let bottomPadding;
  let visibleCards;
  let activeToolbarConfig;
  let activeToolbarDescription;
  let { cards = [] } = $$props;
  let { folderPath = "" } = $$props;
  let { selectedPath = null } = $$props;
  let { loading = false } = $$props;
  let { generation = 0 } = $$props;
  const dispatch = createEventDispatcher();
  const TOOLBAR_ACTIONS = [
    {
      id: "pick-folder",
      label: "Pick folder",
      title: "Folder scope",
      icon: "folder-open"
    },
    {
      id: "new-note",
      label: "New",
      title: "Create note",
      icon: "file-plus"
    },
    {
      id: "sort",
      label: "Sort",
      title: "Sort cards",
      icon: "arrow-up-down"
    },
    {
      id: "filter",
      label: "Filter",
      title: "Filter cards",
      icon: "list-filter"
    },
    {
      id: "bulk",
      label: "Bulk",
      title: "Bulk actions",
      icon: "check-check"
    }
  ];
  let viewportEl = null;
  let viewportHeight = 0;
  let scrollTop = 0;
  let activeToolbarAction = TOOLBAR_ACTIONS[0].id;
  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;
  let heights = [];
  let positions = [];
  let totalHeight = 0;
  function onScroll() {
    if (!viewportEl) {
      return;
    }
    $$invalidate(21, scrollTop = viewportEl.scrollTop);
    $$invalidate(20, viewportHeight = viewportEl.clientHeight);
  }
  function openNote(path) {
    dispatch("open-note", { path });
  }
  function applyIcon(node, iconName) {
    (0, import_obsidian.setIcon)(node, iconName);
    return {
      update(nextIconName) {
        (0, import_obsidian.setIcon)(node, nextIconName);
      }
    };
  }
  function measureHeight(node, index) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let height = entry.borderBoxSize && entry.borderBoxSize.length > 0 ? entry.borderBoxSize[0].blockSize : entry.target.getBoundingClientRect().height;
        height += 12;
        const roundedHeight = Math.round(height);
        if (heights[index] !== roundedHeight) {
          $$invalidate(25, heights[index] = roundedHeight, heights);
          $$invalidate(25, heights), $$invalidate(19, generation), $$invalidate(24, lastHydrateGeneration);
        }
      }
    });
    resizeObserver.observe(node);
    return {
      update(newIndex) {
        index = newIndex;
      },
      destroy() {
        resizeObserver.disconnect();
      }
    };
  }
  function selectToolbarAction(actionId) {
    $$invalidate(4, activeToolbarAction = actionId);
    dispatch("toolbar-action", { action: actionId });
  }
  function onCardKeydown(event, path) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(path);
    }
  }
  const click_handler = (action) => selectToolbarAction(action.id);
  const click_handler_1 = (card) => openNote(card.path);
  const keydown_handler = (card, event) => onCardKeydown(event, card.path);
  function div3_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      viewportEl = $$value;
      $$invalidate(7, viewportEl);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("cards" in $$props2) $$invalidate(0, cards = $$props2.cards);
    if ("folderPath" in $$props2) $$invalidate(1, folderPath = $$props2.folderPath);
    if ("selectedPath" in $$props2) $$invalidate(2, selectedPath = $$props2.selectedPath);
    if ("loading" in $$props2) $$invalidate(3, loading = $$props2.loading);
    if ("generation" in $$props2) $$invalidate(19, generation = $$props2.generation);
  };
  $$self.$$.update = () => {
    var _a;
    if ($$self.$$.dirty[0] & /*generation, lastHydrateGeneration*/
    17301504) {
      $: if (generation !== lastHydrateGeneration) {
        $$invalidate(24, lastHydrateGeneration = generation);
        $$invalidate(22, lastRangeStart = -1);
        $$invalidate(23, lastRangeEnd = -1);
        $$invalidate(25, heights = []);
      }
    }
    if ($$self.$$.dirty[0] & /*cards, heights*/
    33554433) {
      $: {
        let y = 0;
        let newPositions = new Array(cards.length);
        for (let i = 0; i < cards.length; i++) {
          newPositions[i] = y;
          y += heights[i] || ESTIMATED_CARD_HEIGHT;
        }
        $$invalidate(26, positions = newPositions);
        $$invalidate(27, totalHeight = y);
      }
    }
    if ($$self.$$.dirty[0] & /*scrollTop, positions*/
    69206016) {
      $: $$invalidate(30, baseStartIndex = findStartIndex(scrollTop, positions));
    }
    if ($$self.$$.dirty[0] & /*scrollTop, viewportHeight, positions*/
    70254592) {
      $: $$invalidate(29, baseEndIndex = findStartIndex(scrollTop + viewportHeight, positions));
    }
    if ($$self.$$.dirty[0] & /*baseStartIndex*/
    1073741824) {
      $: $$invalidate(5, startIndex = Math.max(0, baseStartIndex - OVERSCAN));
    }
    if ($$self.$$.dirty[0] & /*cards, baseEndIndex*/
    536870913) {
      $: $$invalidate(28, endIndex = Math.min(cards.length, baseEndIndex + 1 + OVERSCAN));
    }
    if ($$self.$$.dirty[0] & /*positions, startIndex*/
    67108896) {
      $: $$invalidate(11, topPadding = positions[startIndex] || 0);
    }
    if ($$self.$$.dirty[0] & /*endIndex, cards, totalHeight, positions*/
    469762049) {
      $: $$invalidate(10, bottomPadding = endIndex < cards.length ? totalHeight - (positions[endIndex] || 0) : 0);
    }
    if ($$self.$$.dirty[0] & /*cards, startIndex, endIndex*/
    268435489) {
      $: $$invalidate(9, visibleCards = cards.slice(startIndex, endIndex));
    }
    if ($$self.$$.dirty[0] & /*activeToolbarAction*/
    16) {
      $: $$invalidate(6, activeToolbarConfig = (_a = TOOLBAR_ACTIONS.find((action) => action.id === activeToolbarAction)) != null ? _a : TOOLBAR_ACTIONS[0]);
    }
    if ($$self.$$.dirty[0] & /*activeToolbarConfig, folderPath*/
    66) {
      $: $$invalidate(8, activeToolbarDescription = describeToolbarAction(activeToolbarConfig.id, folderPath));
    }
    if ($$self.$$.dirty[0] & /*startIndex, lastRangeStart, endIndex, lastRangeEnd*/
    281018400) {
      $: {
        if (startIndex !== lastRangeStart || endIndex !== lastRangeEnd) {
          $$invalidate(22, lastRangeStart = startIndex);
          $$invalidate(23, lastRangeEnd = endIndex);
          dispatch("hydrate-range", { start: startIndex, end: endIndex });
        }
      }
    }
  };
  return [
    cards,
    folderPath,
    selectedPath,
    loading,
    activeToolbarAction,
    startIndex,
    activeToolbarConfig,
    viewportEl,
    activeToolbarDescription,
    visibleCards,
    bottomPadding,
    topPadding,
    TOOLBAR_ACTIONS,
    onScroll,
    openNote,
    applyIcon,
    measureHeight,
    selectToolbarAction,
    onCardKeydown,
    generation,
    viewportHeight,
    scrollTop,
    lastRangeStart,
    lastRangeEnd,
    lastHydrateGeneration,
    heights,
    positions,
    totalHeight,
    endIndex,
    baseEndIndex,
    baseStartIndex,
    click_handler,
    click_handler_1,
    keydown_handler,
    div3_binding
  ];
}
var FolderCardPanel = class extends SvelteComponent {
  constructor(options) {
    super();
    init(
      this,
      options,
      instance,
      create_fragment,
      safe_not_equal,
      {
        cards: 0,
        folderPath: 1,
        selectedPath: 2,
        loading: 3,
        generation: 19
      },
      null,
      [-1, -1]
    );
  }
};
var FolderCardPanel_default = FolderCardPanel;

// src/view/markdown-utils.ts
var MAX_PREVIEW_SCAN_LINES = 400;
function buildLightPreview(markdown, maxVisibleChars = 200, codePreviewLines = 4) {
  var _a;
  const content = stripFrontmatter(markdown).replace(/\r\n/g, "\n");
  const lines = content.split("\n");
  const scanLimit = Math.min(lines.length, MAX_PREVIEW_SCAN_LINES);
  let index = 0;
  while (index < scanLimit) {
    const trimmed = lines[index].trim();
    if (trimmed.length === 0 || isImageOnlyLine(trimmed)) {
      index += 1;
      continue;
    }
    const fence = getFenceInfo(trimmed);
    if (fence) {
      const codeBlock = readFenceCodeBlock(lines, index, scanLimit, fence.marker, fence.size, codePreviewLines);
      if (codeBlock.previewText.length > 0) {
        const clipped = clipTextWithLimit(codeBlock.previewText, maxVisibleChars);
        let display = clipped.text.trimEnd();
        if ((clipped.truncated || codeBlock.truncatedByLines) && display.length > 0) {
          display = display.includes("\n") ? `${display}
...` : `${display}...`;
        }
        if (display.length > 0) {
          return {
            html: `<pre class="fce-preview-code"><code>${escapeHtml(display)}</code></pre>`,
            mode: "code"
          };
        }
      }
      index = codeBlock.nextIndex;
      continue;
    }
    break;
  }
  let remainingChars = maxVisibleChars;
  const htmlParts = [];
  let listMode = null;
  while (index < scanLimit && remainingChars > 0) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (listMode) {
        htmlParts.push(`</${listMode}>`);
        listMode = null;
      }
      index += 1;
      continue;
    }
    if (isImageOnlyLine(trimmed)) {
      index += 1;
      continue;
    }
    const fence = getFenceInfo(trimmed);
    if (fence) {
      index = skipFenceCodeBlock(lines, index, scanLimit, fence.marker, fence.size);
      continue;
    }
    const headingMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch == null ? void 0 : headingMatch[1]) {
      if (listMode) {
        htmlParts.push(`</${listMode}>`);
        listMode = null;
      }
      const rendered2 = renderInlineWithLimit(headingMatch[1], remainingChars);
      if (rendered2.consumedChars > 0) {
        htmlParts.push(`<p class="fce-preview-heading">${rendered2.html}</p>`);
        remainingChars -= rendered2.consumedChars;
      }
      if (rendered2.truncated) {
        break;
      }
      index += 1;
      continue;
    }
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch == null ? void 0 : ulMatch[1]) {
      if (listMode !== "ul") {
        if (listMode) {
          htmlParts.push(`</${listMode}>`);
        }
        htmlParts.push("<ul>");
        listMode = "ul";
      }
      const rendered2 = renderInlineWithLimit(ulMatch[1], remainingChars);
      if (rendered2.consumedChars > 0) {
        htmlParts.push(`<li>${rendered2.html}</li>`);
        remainingChars -= rendered2.consumedChars;
      }
      if (rendered2.truncated) {
        break;
      }
      index += 1;
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch == null ? void 0 : olMatch[1]) {
      if (listMode !== "ol") {
        if (listMode) {
          htmlParts.push(`</${listMode}>`);
        }
        htmlParts.push("<ol>");
        listMode = "ol";
      }
      const rendered2 = renderInlineWithLimit(olMatch[1], remainingChars);
      if (rendered2.consumedChars > 0) {
        htmlParts.push(`<li>${rendered2.html}</li>`);
        remainingChars -= rendered2.consumedChars;
      }
      if (rendered2.truncated) {
        break;
      }
      index += 1;
      continue;
    }
    if (listMode) {
      htmlParts.push(`</${listMode}>`);
      listMode = null;
    }
    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      const quoteText = (_a = quoteMatch[1]) != null ? _a : "";
      const rendered2 = renderInlineWithLimit(quoteText, remainingChars);
      if (rendered2.consumedChars > 0) {
        htmlParts.push(`<blockquote>${rendered2.html}</blockquote>`);
        remainingChars -= rendered2.consumedChars;
      }
      if (rendered2.truncated) {
        break;
      }
      index += 1;
      continue;
    }
    const paragraphLines = [trimmed];
    let cursor = index + 1;
    while (cursor < scanLimit) {
      const next = lines[cursor].trim();
      if (next.length === 0 || isBlockStarter(next)) {
        break;
      }
      paragraphLines.push(next);
      cursor += 1;
    }
    const rendered = renderInlineWithLimit(paragraphLines.join(" "), remainingChars);
    if (rendered.consumedChars > 0) {
      htmlParts.push(`<p>${rendered.html}</p>`);
      remainingChars -= rendered.consumedChars;
    }
    if (rendered.truncated) {
      break;
    }
    index = cursor;
  }
  if (listMode) {
    htmlParts.push(`</${listMode}>`);
  }
  if (htmlParts.length === 0) {
    return { html: "", mode: "empty" };
  }
  return { html: htmlParts.join(""), mode: "text" };
}
function stripFrontmatter(markdown) {
  return markdown.replace(/^---[\s\S]*?---\s*/m, "");
}
function isBlockStarter(line) {
  return isImageOnlyLine(line) || /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^>\s?/.test(line) || !!getFenceInfo(line);
}
function isImageOnlyLine(line) {
  const trimmed = line.trim();
  if (/^!\[\[[^\]]+]]$/.test(trimmed)) {
    return true;
  }
  if (/^!\[[^\]]*]\([^)]+\)$/.test(trimmed)) {
    return true;
  }
  return /^<img\s[^>]*>$/i.test(trimmed);
}
function getFenceInfo(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  if (!(match == null ? void 0 : match[1])) {
    return null;
  }
  const token = match[1];
  const marker = token[0];
  return { marker, size: token.length };
}
function readFenceCodeBlock(lines, startIndex, scanLimit, marker, size, previewLines = 4) {
  const body = [];
  let cursor = startIndex + 1;
  while (cursor < scanLimit) {
    const line = lines[cursor];
    if (isFenceClosingLine(line.trim(), marker, size)) {
      cursor += 1;
      break;
    }
    body.push(line);
    cursor += 1;
  }
  const selected = body.slice(0, previewLines);
  return {
    previewText: selected.join("\n").trimEnd(),
    truncatedByLines: body.length > previewLines,
    nextIndex: cursor
  };
}
function skipFenceCodeBlock(lines, startIndex, scanLimit, marker, size) {
  let cursor = startIndex + 1;
  while (cursor < scanLimit) {
    if (isFenceClosingLine(lines[cursor].trim(), marker, size)) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}
function renderInlineWithLimit(source, limit) {
  if (limit <= 0) {
    return { html: "", consumedChars: 0, truncated: true };
  }
  const normalized = normalizeInlineSource(source);
  if (normalized.length === 0) {
    return { html: "", consumedChars: 0, truncated: false };
  }
  const segments = parseInlineSegments(normalized);
  let remaining = limit;
  let consumedChars = 0;
  const htmlParts = [];
  let truncated = false;
  for (const segment of segments) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const slice = segment.text.slice(0, remaining);
    if (slice.length === 0) {
      continue;
    }
    consumedChars += slice.length;
    remaining -= slice.length;
    const escaped = escapeHtml(slice);
    if (segment.type === "strong") {
      htmlParts.push(`<strong>${escaped}</strong>`);
    } else if (segment.type === "em") {
      htmlParts.push(`<em>${escaped}</em>`);
    } else if (segment.type === "code") {
      htmlParts.push(`<code>${escaped}</code>`);
    } else {
      htmlParts.push(escaped);
    }
    if (slice.length < segment.text.length) {
      truncated = true;
      break;
    }
  }
  if (!truncated && consumedChars < normalized.length) {
    truncated = true;
  }
  if (truncated && htmlParts.length > 0) {
    htmlParts.push("...");
  }
  return {
    html: htmlParts.join(""),
    consumedChars,
    truncated
  };
}
function normalizeInlineSource(source) {
  return source.replace(/!\[[^\]]*]\([^)]+\)/g, " ").replace(/!\[\[[^\]]+]]/g, " ").replace(/<img\s[^>]*>/gi, " ").replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_match, link, alias) => alias != null ? alias : link).replace(/\s+/g, " ").trim();
}
function parseInlineSegments(source) {
  const segments = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      const marker = source.slice(index, index + 2);
      const close = source.indexOf(marker, index + 2);
      if (close > index + 2) {
        segments.push({ type: "strong", text: source.slice(index + 2, close) });
        index = close + 2;
        continue;
      }
    }
    if (source[index] === "*" || source[index] === "_") {
      const marker = source[index];
      const close = source.indexOf(marker, index + 1);
      if (close > index + 1) {
        segments.push({ type: "em", text: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }
    if (source[index] === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        segments.push({ type: "code", text: source.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
    }
    let next = index + 1;
    while (next < source.length && !startsInlineMarker(source, next)) {
      next += 1;
    }
    segments.push({ type: "text", text: source.slice(index, next) });
    index = next;
  }
  return segments;
}
function startsInlineMarker(source, index) {
  return source.startsWith("**", index) || source.startsWith("__", index) || source[index] === "*" || source[index] === "_" || source[index] === "`";
}
function isFenceClosingLine(line, marker, size) {
  const trimmed = line.trim();
  if (trimmed.length < size) {
    return false;
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== marker) {
      return false;
    }
  }
  return true;
}
function clipTextWithLimit(text2, limit) {
  if (text2.length <= limit) {
    return { text: text2, truncated: false };
  }
  return {
    text: text2.slice(0, limit),
    truncated: true
  };
}
function escapeHtml(input) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

// src/view/FolderCardView.ts
var FOLDER_CARD_VIEW = "folder-card-view";
var FolderCardView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.component = null;
    this.hostEl = null;
    this.folderPath = null;
    this.folderLoadKey = null;
    this.cards = [];
    this.selectedPath = null;
    this.loading = false;
    this.generation = 0;
    this.pendingHydration = /* @__PURE__ */ new Set();
    this.requestSeq = 0;
    this.inFlight = null;
    this.inFlightKey = null;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.plugin = plugin;
  }
  getViewType() {
    return FOLDER_CARD_VIEW;
  }
  getDisplayText() {
    return "Folder Card Explorer";
  }
  getIcon() {
    return "gallery-horizontal";
  }
  async onOpen() {
    var _a, _b;
    const target = (_a = this.containerEl.children[1]) != null ? _a : this.containerEl;
    target.empty();
    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = new FolderCardPanel_default({
      target: this.hostEl,
      props: {
        cards: this.cards,
        folderPath: (_b = this.folderPath) != null ? _b : "",
        selectedPath: this.selectedPath,
        loading: this.loading,
        generation: this.generation
      }
    });
    this.component.$on("open-note", (event) => {
      this.plugin.openNoteFromCard(event.detail.path);
    });
    this.component.$on("hydrate-range", (event) => {
      void this.hydrateRange(event.detail.start, event.detail.end);
    });
  }
  async onClose() {
    var _a;
    this.cleanupLifecycle();
    (_a = this.component) == null ? void 0 : _a.$destroy();
    this.component = null;
    this.hostEl = null;
  }
  async setFolder(folder) {
    const request = this.createProgrammaticSelectionRequest(folder.path, false);
    return this.handleFolderSelection(request);
  }
  async handleFolderSelection(request) {
    var _a;
    const folder = this.app.vault.getAbstractFileByPath(request.folderPath);
    if (!(folder instanceof import_obsidian2.TFolder)) {
      return {
        action: "rejected_invalid",
        folderPath: request.folderPath,
        generationChanged: false,
        preserveUiState: true
      };
    }
    const forceRefresh = (_a = request.forceRefresh) != null ? _a : false;
    const loadKey = this.serializeLoadKey(this.buildLoadKey(folder.path));
    if (this.inFlight) {
      if (!forceRefresh && this.inFlightKey === loadKey) {
        return {
          action: "reused_inflight",
          folderPath: folder.path,
          generationChanged: false,
          preserveUiState: true
        };
      }
      this.queuedRequest = request;
      return {
        action: "queued_latest",
        folderPath: folder.path,
        generationChanged: false,
        preserveUiState: true
      };
    }
    if (!forceRefresh && this.folderLoadKey === loadKey) {
      return {
        action: "noop",
        folderPath: folder.path,
        generationChanged: false,
        preserveUiState: true
      };
    }
    await this.runLoad(folder, loadKey);
    await this.drainQueuedRequest();
    return {
      action: "started",
      folderPath: folder.path,
      generationChanged: true,
      preserveUiState: false
    };
  }
  async refresh(request = { reason: "manual" }) {
    var _a, _b;
    const targetPath = (_a = request.folderPath) != null ? _a : this.folderPath;
    if (!targetPath) {
      return {
        action: "skipped_no_folder",
        inFlightKey: this.inFlightKey
      };
    }
    if (request.reason === "vault-change") {
      this.refreshQueued = false;
    }
    const selectionRequest = this.createProgrammaticSelectionRequest(
      targetPath,
      (_b = request.forceRefresh) != null ? _b : true
    );
    const selectionResult = await this.handleFolderSelection(selectionRequest);
    if (selectionResult.action === "rejected_invalid") {
      return {
        action: "skipped_invalid_folder",
        inFlightKey: this.inFlightKey
      };
    }
    if (selectionResult.action === "started") {
      return {
        action: "started",
        inFlightKey: this.inFlightKey
      };
    }
    return {
      action: "queued_latest",
      inFlightKey: this.inFlightKey
    };
  }
  handleVaultMutation(event) {
    let selectedFolderPathAfterRename = null;
    if (event.eventType === "rename" && event.isFolder && event.oldPath) {
      const renamedPath = this.rewritePathAfterRename(this.folderPath, event.oldPath, event.path);
      if (renamedPath !== this.folderPath) {
        this.folderPath = renamedPath;
        this.folderLoadKey = renamedPath ? this.serializeLoadKey(this.buildLoadKey(renamedPath)) : null;
        selectedFolderPathAfterRename = renamedPath;
      }
    }
    if (!this.shouldRefreshForVaultEvent(event)) {
      return {
        shouldRefresh: false,
        queueAction: "ignored",
        selectedFolderPathAfterRename
      };
    }
    const queueAction = this.inFlight ? "deferred_while_inflight" : "enqueued";
    this.refreshQueued = true;
    return {
      shouldRefresh: true,
      queueAction,
      selectedFolderPathAfterRename
    };
  }
  cleanupLifecycle() {
    const hadQueuedRequest = this.queuedRequest !== null || this.refreshQueued;
    const hadPendingHydration = this.pendingHydration.size > 0;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.pendingHydration.clear();
    this.inFlight = null;
    this.inFlightKey = null;
    this.loading = false;
    this.generation += 1;
    return {
      cancelledDebounce: false,
      clearedQueuedRequest: hadQueuedRequest,
      clearedPendingHydration: hadPendingHydration
    };
  }
  setSelectedFile(path) {
    if (this.selectedPath === path) {
      return;
    }
    this.selectedPath = path;
    this.pushState(false);
  }
  getCurrentFolderPath() {
    return this.folderPath;
  }
  createProgrammaticSelectionRequest(folderPath, forceRefresh) {
    this.requestSeq += 1;
    return {
      requestId: this.requestSeq,
      folderPath,
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh
    };
  }
  buildLoadKey(folderPath) {
    const settings = this.plugin.getSettings();
    return {
      folderPath,
      includeSubfolders: settings.includeSubfolders,
      sortField: settings.sort.field,
      sortDirection: settings.sort.direction
    };
  }
  serializeLoadKey(loadKey) {
    return `${loadKey.folderPath}::${loadKey.includeSubfolders}::${loadKey.sortField}::${loadKey.sortDirection}`;
  }
  async runLoad(folder, loadKey) {
    const task = this.loadFolder(folder, loadKey);
    this.inFlight = task;
    this.inFlightKey = loadKey;
    try {
      await task;
    } finally {
      if (this.inFlight === task) {
        this.inFlight = null;
        this.inFlightKey = null;
      }
    }
  }
  async loadFolder(folder, loadKey) {
    this.folderPath = folder.path;
    this.loading = true;
    this.cards = [];
    this.generation += 1;
    this.pendingHydration.clear();
    this.pushState();
    const buildGeneration = this.generation;
    const settings = this.plugin.getSettings();
    try {
      const files = this.collectMarkdownFiles(folder, settings.includeSubfolders);
      const records = files.map((file) => {
        return {
          file,
          path: file.path,
          title: file.basename,
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
          excerpt: "",
          previewHtml: "",
          previewMode: "empty",
          hydrated: false
        };
      });
      if (buildGeneration !== this.generation) {
        return;
      }
      records.sort(
        (left, right) => this.compareCards(left, right, settings.sort.field, settings.sort.direction)
      );
      this.cards = records;
      this.folderLoadKey = loadKey;
    } finally {
      if (buildGeneration === this.generation) {
        this.loading = false;
        this.pushState();
      }
    }
  }
  async drainQueuedRequest() {
    if (this.inFlight) {
      return;
    }
    const queued = this.queuedRequest;
    if (!queued) {
      return;
    }
    this.queuedRequest = null;
    await this.handleFolderSelection(queued);
  }
  shouldRefreshForVaultEvent(event) {
    if (!this.folderPath) {
      return false;
    }
    if (!event.isFolder && !event.isMarkdown) {
      return false;
    }
    const includeSubfolders = this.plugin.getSettings().includeSubfolders;
    const pathInScope = this.isPathInScope(event.path, includeSubfolders);
    const oldPathInScope = typeof event.oldPath === "string" && event.oldPath.length > 0 ? this.isPathInScope(event.oldPath, includeSubfolders) : false;
    return pathInScope || oldPathInScope;
  }
  isPathInScope(path, includeSubfolders) {
    if (!this.folderPath) {
      return false;
    }
    if (path === this.folderPath) {
      return true;
    }
    const prefix = `${this.folderPath}/`;
    if (!path.startsWith(prefix)) {
      return false;
    }
    if (includeSubfolders) {
      return true;
    }
    const relative = path.slice(prefix.length);
    return !relative.includes("/");
  }
  rewritePathAfterRename(currentPath, oldPath, newPath) {
    if (!currentPath) {
      return currentPath;
    }
    if (currentPath === oldPath) {
      return newPath;
    }
    const prefix = `${oldPath}/`;
    if (!currentPath.startsWith(prefix)) {
      return currentPath;
    }
    return `${newPath}${currentPath.slice(oldPath.length)}`;
  }
  collectMarkdownFiles(root, includeSubfolders) {
    if (!includeSubfolders) {
      const directFiles = [];
      for (const child of root.children) {
        if (child instanceof import_obsidian2.TFile && child.extension.toLowerCase() === "md") {
          directFiles.push(child);
        }
      }
      return directFiles;
    }
    const result = [];
    const stack = [root];
    while (stack.length > 0) {
      const folder = stack.pop();
      if (!folder) {
        continue;
      }
      for (const child of folder.children) {
        if (child instanceof import_obsidian2.TFolder) {
          stack.push(child);
          continue;
        }
        if (child instanceof import_obsidian2.TFile && child.extension.toLowerCase() === "md") {
          result.push(child);
        }
      }
    }
    return result;
  }
  compareCards(left, right, field, direction) {
    const leftValue = field === "ctime" ? left.ctime : left.mtime;
    const rightValue = field === "ctime" ? right.ctime : right.mtime;
    const difference = leftValue - rightValue;
    if (difference !== 0) {
      return direction === "asc" ? difference : -difference;
    }
    return left.path.localeCompare(right.path);
  }
  async hydrateRange(start, end) {
    if (this.cards.length === 0 || this.loading) {
      return;
    }
    const generation = this.generation;
    const targets = [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(this.cards.length, end);
    for (let index = safeStart; index < safeEnd; index += 1) {
      const card = this.cards[index];
      if (!card || card.hydrated || this.pendingHydration.has(index)) {
        continue;
      }
      this.pendingHydration.add(index);
      targets.push(index);
    }
    if (targets.length === 0) {
      return;
    }
    await Promise.all(targets.map((index) => this.hydrateCard(index, generation)));
    targets.forEach((index) => this.pendingHydration.delete(index));
    if (generation === this.generation) {
      this.pushState();
    }
  }
  async hydrateCard(index, generation) {
    const card = this.cards[index];
    if (!card) {
      return;
    }
    try {
      const markdown = await this.app.vault.cachedRead(card.file);
      if (generation !== this.generation) {
        return;
      }
      const preview = buildLightPreview(markdown, 200, 4);
      card.previewHtml = preview.html;
      card.previewMode = preview.mode;
      card.hydrated = true;
    } catch (e) {
      card.excerpt = "";
      card.previewHtml = "";
      card.previewMode = "empty";
      card.hydrated = true;
    }
  }
  pushState(cloneCards = true) {
    var _a, _b;
    (_b = this.component) == null ? void 0 : _b.$set({
      cards: cloneCards ? [...this.cards] : this.cards,
      folderPath: (_a = this.folderPath) != null ? _a : "",
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.generation
    });
  }
};

// src/main.ts
var FolderCardExplorerPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.selectedFolderPath = null;
    this.settings = normalizeSettings(DEFAULT_SETTINGS);
    this.selectionRequestSeq = 0;
    this.latestHandledRequestId = 0;
    this.debouncedRefresh = (0, import_obsidian3.debounce)(
      () => {
        void this.requestRefreshForViews("vault-change");
      },
      250,
      false
    );
  }
  async onload() {
    await this.loadSettings();
    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));
    this.addCommand({
      id: "open-folder-card-explorer",
      name: "Open Folder Card Explorer view",
      callback: () => {
        void this.activateView();
      }
    });
    this.registerDomEvent(document, "click", (event) => {
      void this.onFileExplorerClick(event);
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncSelection(file instanceof import_obsidian3.TFile ? file.path : null);
      })
    );
    this.app.workspace.onLayoutReady(() => {
      var _a;
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection((_a = activeFile == null ? void 0 : activeFile.path) != null ? _a : null);
    });
  }
  async onunload() {
    var _a;
    const debouncedRefresh = this.debouncedRefresh;
    (_a = debouncedRefresh.cancel) == null ? void 0 : _a.call(debouncedRefresh);
    this.withFolderViews((view) => {
      view.cleanupLifecycle();
    });
    this.app.workspace.detachLeavesOfType(FOLDER_CARD_VIEW);
  }
  async openNoteFromCard(path) {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof import_obsidian3.TFile)) {
      return;
    }
    const leaf = this.resolveTargetLeaf();
    await leaf.openFile(target, { active: true });
    this.syncSelection(target.path);
  }
  getSettings() {
    return normalizeSettings(this.settings);
  }
  async saveSettings(patch) {
    this.settings = mergeSettings(this.settings, patch);
    await this.saveData(this.settings);
    await this.requestRefreshForViews("settings-change");
  }
  resolveTargetLeaf() {
    const activeMarkdown = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (activeMarkdown) {
      return activeMarkdown.leaf;
    }
    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    if (existingMarkdown.length > 0) {
      return existingMarkdown[0];
    }
    return this.app.workspace.getLeaf(true);
  }
  async onFileExplorerClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    const folderPath = this.extractFolderPathFromTarget(target);
    if (!folderPath) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof import_obsidian3.TFolder)) {
      return;
    }
    const request = this.createSelectionRequest(folder.path, "explorer-click");
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
  }
  extractFolderPathFromTarget(target) {
    var _a, _b, _c;
    const titleEl = target.closest(".nav-folder-title");
    if (!titleEl) {
      return null;
    }
    return (_c = (_b = titleEl.getAttribute("data-path")) != null ? _b : (_a = titleEl.closest(".nav-folder")) == null ? void 0 : _a.getAttribute("data-path")) != null ? _c : null;
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType(FOLDER_CARD_VIEW);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({
        type: FOLDER_CARD_VIEW,
        active: true
      });
    }
    if (!leaf) {
      return;
    }
    workspace.revealLeaf(leaf);
  }
  withFolderViews(callback) {
    this.app.workspace.getLeavesOfType(FOLDER_CARD_VIEW).forEach((leaf) => {
      if (leaf.view instanceof FolderCardView) {
        callback(leaf.view);
      }
    });
  }
  syncSelection(path) {
    this.withFolderViews((view) => view.setSelectedFile(path));
  }
  registerVaultObservers() {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("create", file, null));
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("modify", file, null));
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("delete", file, null));
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("rename", file, oldPath));
      })
    );
  }
  async loadSettings() {
    const rawData = await this.loadData();
    this.settings = normalizeSettings(rawData);
  }
  createSelectionRequest(folderPath, source, forceRefresh = false) {
    this.selectionRequestSeq += 1;
    const request = {
      requestId: this.selectionRequestSeq,
      folderPath,
      source,
      requestedAtMs: Date.now(),
      forceRefresh
    };
    this.latestHandledRequestId = request.requestId;
    return request;
  }
  dispatchSelectionRequest(request) {
    this.withFolderViews((view) => {
      void this.handleSelectionResult(view, request);
    });
  }
  async handleSelectionResult(view, request) {
    const result = await view.handleFolderSelection(request);
    if (result.action === "rejected_invalid") {
      return;
    }
    if (request.source === "explorer-click" && request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.selectedFolderPath = result.folderPath;
  }
  buildVaultMutationEvent(eventType, file, oldPath) {
    return {
      eventType,
      path: file.path,
      oldPath,
      isFolder: file instanceof import_obsidian3.TFolder,
      isMarkdown: file instanceof import_obsidian3.TFile && file.extension.toLowerCase() === "md"
    };
  }
  dispatchVaultMutation(event) {
    this.reconcileSelectedFolderPath(event);
    let shouldQueueRefresh = false;
    this.withFolderViews((view) => {
      const result = view.handleVaultMutation(event);
      if (result.selectedFolderPathAfterRename) {
        this.selectedFolderPath = result.selectedFolderPathAfterRename;
      }
      if (result.shouldRefresh) {
        shouldQueueRefresh = true;
      }
    });
    if (shouldQueueRefresh) {
      this.debouncedRefresh();
    }
  }
  reconcileSelectedFolderPath(event) {
    if (event.eventType !== "rename" || !event.isFolder || !this.selectedFolderPath || !event.oldPath) {
      return;
    }
    if (this.selectedFolderPath === event.oldPath) {
      this.selectedFolderPath = event.path;
      return;
    }
    const prefix = `${event.oldPath}/`;
    if (this.selectedFolderPath.startsWith(prefix)) {
      this.selectedFolderPath = `${event.path}${this.selectedFolderPath.slice(event.oldPath.length)}`;
    }
  }
  async requestRefreshForViews(reason) {
    if (!this.selectedFolderPath) {
      return;
    }
    this.withFolderViews((view) => {
      var _a;
      void view.refresh({
        reason,
        folderPath: (_a = this.selectedFolderPath) != null ? _a : void 0,
        forceRefresh: true
      });
    });
  }
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                  ectedFolderPath.slice(event.oldPath.length)}`;
    }
  }
  async requestRefreshForViews(reason) {
    if (!this.selectedFolderPath) {
      return;
    }
    this.withFolderViews((view) => {
      var _a;
      void view.refresh({
        reason,
        folderPath: (_a = this.selectedFolderPath) != null ? _a : void 0,
        forceRefresh: true
      });
    });
  }
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           (
      this.app.vault.on("rename", (file, oldPath) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("rename", file, oldPath));
      })
    );
  }
  async loadSettings() {
    const rawData = await this.loadData();
    this.settings = normalizeSettings(rawData);
  }
  createSelectionRequest(folderPath, source, forceRefresh = false) {
    this.selectionRequestSeq += 1;
    const request = {
      requestId: this.selectionRequestSeq,
      folderPath,
      source,
      requestedAtMs: Date.now(),
      forceRefresh
    };
    this.latestHandledRequestId = request.requestId;
    return request;
  }
  dispatchSelectionRequest(request) {
    this.withFolderViews((view) => {
      void this.handleSelectionResult(view, request);
    });
  }
  async handleSelectionResult(view, request) {
    const result = await view.handleFolderSelection(request);
    if (result.action === "rejected_invalid") {
      return;
    }
    if (request.source === "explorer-click" && request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.selectedFolderPath = result.folderPath;
  }
  buildVaultMutationEvent(eventType, file, oldPath) {
    return {
      eventType,
      path: file.path,
      oldPath,
      isFolder: file instanceof import_obsidian3.TFolder,
      isMarkdown: file instanceof import_obsidian3.TFile && file.extension.toLowerCase() === "md"
    };
  }
  dispatchVaultMutation(event) {
    this.reconcileSelectedFolderPath(event);
    let shouldQueueRefresh = false;
    this.withFolderViews((view) => {
      const result = view.handleVaultMutation(event);
      if (result.selectedFolderPathAfterRename) {
        this.selectedFolderPath = result.selectedFolderPathAfterRename;
      }
      if (result.shouldRefresh) {
        shouldQueueRefresh = true;
      }
    });
    if (shouldQueueRefresh) {
      this.debouncedRefresh();
    }
  }
  reconcileSelectedFolderPath(event) {
    if (event.eventType !== "rename" || !event.isFolder || !this.selectedFolderPath || !event.oldPath) {
      return;
    }
    if (this.selectedFolderPath === event.oldPath) {
      this.selectedFolderPath = event.path;
      return;
    }
    const prefix = `${event.oldPath}/`;
    if (this.selectedFolderPath.startsWith(prefix)) {
      this.selectedFolderPath = `${event.path}${this.selectedFolderPath.slice(event.oldPath.length)}`;
    }
  }
  async requestRefreshForViews(reason) {
    if (!this.selectedFolderPath) {
      return;
    }
    this.withFolderViews((view) => {
      var _a;
      void view.refresh({
        reason,
        folderPath: (_a = this.selectedFolderPath) != null ? _a : void 0,
        forceRefresh: true
      });
    });
  }
};
