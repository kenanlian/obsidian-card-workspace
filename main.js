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
var src_url_equal_anchor;
function src_url_equal(element_src, url) {
  if (element_src === url) return true;
  if (!src_url_equal_anchor) {
    src_url_equal_anchor = document.createElement("a");
  }
  src_url_equal_anchor.href = url;
  return element_src === src_url_equal_anchor.href;
}
function is_empty(obj) {
  return Object.keys(obj).length === 0;
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
function text(data) {
  return document.createTextNode(data);
}
function space() {
  return text(" ");
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
function get_each_context(ctx, list, i) {
  const child_ctx = ctx.slice();
  child_ctx[24] = list[i];
  return child_ctx;
}
function create_else_block_2(ctx) {
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
      if (dirty & /*folderPath*/
      2) set_data(
        t0,
        /*folderPath*/
        ctx2[1]
      );
      if (dirty & /*cards*/
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
    ctx[5]
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
      ctx[7]}px;`);
      attr(div1, "style", div1_style_value = `height: ${/*bottomPadding*/
      ctx[6]}px;`);
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
      if (dirty & /*topPadding*/
      128 && div0_style_value !== (div0_style_value = `height: ${/*topPadding*/
      ctx2[7]}px;`)) {
        attr(div0, "style", div0_style_value);
      }
      if (dirty & /*selectedPath, visibleCards, openNote, onCardKeydown, formatDate*/
      1572) {
        each_value = ensure_array_like(
          /*visibleCards*/
          ctx2[5]
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
      if (dirty & /*bottomPadding*/
      64 && div1_style_value !== (div1_style_value = `height: ${/*bottomPadding*/
      ctx2[6]}px;`)) {
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
function create_if_block_3(ctx) {
  let img;
  let img_src_value;
  let img_alt_value;
  return {
    c() {
      img = element("img");
      attr(img, "class", "fce-cover");
      if (!src_url_equal(img.src, img_src_value = /*card*/
      ctx[24].cover)) attr(img, "src", img_src_value);
      attr(img, "alt", img_alt_value = /*card*/
      ctx[24].title);
      attr(img, "loading", "lazy");
    },
    m(target, anchor) {
      insert(target, img, anchor);
    },
    p(ctx2, dirty) {
      if (dirty & /*visibleCards*/
      32 && !src_url_equal(img.src, img_src_value = /*card*/
      ctx2[24].cover)) {
        attr(img, "src", img_src_value);
      }
      if (dirty & /*visibleCards*/
      32 && img_alt_value !== (img_alt_value = /*card*/
      ctx2[24].title)) {
        attr(img, "alt", img_alt_value);
      }
    },
    d(detaching) {
      if (detaching) {
        detach(img);
      }
    }
  };
}
function create_else_block_1(ctx) {
  let t;
  return {
    c() {
      t = text("Loading preview...");
    },
    m(target, anchor) {
      insert(target, t, anchor);
    },
    p: noop,
    d(detaching) {
      if (detaching) {
        detach(t);
      }
    }
  };
}
function create_if_block_2(ctx) {
  let t_value = (
    /*card*/
    ctx[24].excerpt + ""
  );
  let t;
  return {
    c() {
      t = text(t_value);
    },
    m(target, anchor) {
      insert(target, t, anchor);
    },
    p(ctx2, dirty) {
      if (dirty & /*visibleCards*/
      32 && t_value !== (t_value = /*card*/
      ctx2[24].excerpt + "")) set_data(t, t_value);
    },
    d(detaching) {
      if (detaching) {
        detach(t);
      }
    }
  };
}
function create_each_block(ctx) {
  let div1;
  let t0;
  let div0;
  let h4;
  let t1_value = (
    /*card*/
    ctx[24].title + ""
  );
  let t1;
  let t2;
  let p0;
  let t3;
  let t4_value = formatDate(
    /*card*/
    ctx[24].mtime
  ) + "";
  let t4;
  let t5;
  let t6_value = formatDate(
    /*card*/
    ctx[24].ctime
  ) + "";
  let t6;
  let t7;
  let p1;
  let div1_class_value;
  let mounted;
  let dispose;
  let if_block0 = (
    /*card*/
    ctx[24].cover && create_if_block_3(ctx)
  );
  function select_block_type_2(ctx2, dirty) {
    if (
      /*card*/
      ctx2[24].hydrated && /*card*/
      ctx2[24].excerpt
    ) return create_if_block_2;
    return create_else_block_1;
  }
  let current_block_type = select_block_type_2(ctx, -1);
  let if_block1 = current_block_type(ctx);
  function click_handler() {
    return (
      /*click_handler*/
      ctx[20](
        /*card*/
        ctx[24]
      )
    );
  }
  function keydown_handler(...args) {
    return (
      /*keydown_handler*/
      ctx[21](
        /*card*/
        ctx[24],
        ...args
      )
    );
  }
  return {
    c() {
      div1 = element("div");
      if (if_block0) if_block0.c();
      t0 = space();
      div0 = element("div");
      h4 = element("h4");
      t1 = text(t1_value);
      t2 = space();
      p0 = element("p");
      t3 = text("Modified ");
      t4 = text(t4_value);
      t5 = text(" \xB7 Created ");
      t6 = text(t6_value);
      t7 = space();
      p1 = element("p");
      if_block1.c();
      attr(p0, "class", "fce-meta");
      attr(p1, "class", "fce-excerpt");
      attr(div0, "class", "fce-card-body");
      attr(div1, "class", div1_class_value = "fce-card " + /*selectedPath*/
      (ctx[2] === /*card*/
      ctx[24].path ? "is-selected" : ""));
      attr(div1, "role", "button");
      attr(div1, "tabindex", "0");
    },
    m(target, anchor) {
      insert(target, div1, anchor);
      if (if_block0) if_block0.m(div1, null);
      append(div1, t0);
      append(div1, div0);
      append(div0, h4);
      append(h4, t1);
      append(div0, t2);
      append(div0, p0);
      append(p0, t3);
      append(p0, t4);
      append(p0, t5);
      append(p0, t6);
      append(div0, t7);
      append(div0, p1);
      if_block1.m(p1, null);
      if (!mounted) {
        dispose = [
          listen(div1, "click", click_handler),
          listen(div1, "keydown", keydown_handler)
        ];
        mounted = true;
      }
    },
    p(new_ctx, dirty) {
      ctx = new_ctx;
      if (
        /*card*/
        ctx[24].cover
      ) {
        if (if_block0) {
          if_block0.p(ctx, dirty);
        } else {
          if_block0 = create_if_block_3(ctx);
          if_block0.c();
          if_block0.m(div1, t0);
        }
      } else if (if_block0) {
        if_block0.d(1);
        if_block0 = null;
      }
      if (dirty & /*visibleCards*/
      32 && t1_value !== (t1_value = /*card*/
      ctx[24].title + "")) set_data(t1, t1_value);
      if (dirty & /*visibleCards*/
      32 && t4_value !== (t4_value = formatDate(
        /*card*/
        ctx[24].mtime
      ) + "")) set_data(t4, t4_value);
      if (dirty & /*visibleCards*/
      32 && t6_value !== (t6_value = formatDate(
        /*card*/
        ctx[24].ctime
      ) + "")) set_data(t6, t6_value);
      if (current_block_type === (current_block_type = select_block_type_2(ctx, dirty)) && if_block1) {
        if_block1.p(ctx, dirty);
      } else {
        if_block1.d(1);
        if_block1 = current_block_type(ctx);
        if (if_block1) {
          if_block1.c();
          if_block1.m(p1, null);
        }
      }
      if (dirty & /*selectedPath, visibleCards*/
      36 && div1_class_value !== (div1_class_value = "fce-card " + /*selectedPath*/
      (ctx[2] === /*card*/
      ctx[24].path ? "is-selected" : ""))) {
        attr(div1, "class", div1_class_value);
      }
    },
    d(detaching) {
      if (detaching) {
        detach(div1);
      }
      if (if_block0) if_block0.d();
      if_block1.d();
      mounted = false;
      run_all(dispose);
    }
  };
}
function create_fragment(ctx) {
  let div1;
  let header;
  let h3;
  let t1;
  let t2;
  let div0;
  let mounted;
  let dispose;
  function select_block_type(ctx2, dirty) {
    if (
      /*folderPath*/
      ctx2[1]
    ) return create_if_block_4;
    return create_else_block_2;
  }
  let current_block_type = select_block_type(ctx, -1);
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
  let current_block_type_1 = select_block_type_1(ctx, -1);
  let if_block1 = current_block_type_1(ctx);
  return {
    c() {
      div1 = element("div");
      header = element("header");
      h3 = element("h3");
      h3.textContent = "Folder Card Explorer";
      t1 = space();
      if_block0.c();
      t2 = space();
      div0 = element("div");
      if_block1.c();
      attr(header, "class", "fce-header");
      attr(div0, "class", "fce-list");
      attr(div1, "class", "fce-shell");
    },
    m(target, anchor) {
      insert(target, div1, anchor);
      append(div1, header);
      append(header, h3);
      append(header, t1);
      if_block0.m(header, null);
      append(div1, t2);
      append(div1, div0);
      if_block1.m(div0, null);
      ctx[22](div0);
      if (!mounted) {
        dispose = listen(
          div0,
          "scroll",
          /*onScroll*/
          ctx[8]
        );
        mounted = true;
      }
    },
    p(ctx2, [dirty]) {
      if (current_block_type === (current_block_type = select_block_type(ctx2, dirty)) && if_block0) {
        if_block0.p(ctx2, dirty);
      } else {
        if_block0.d(1);
        if_block0 = current_block_type(ctx2);
        if (if_block0) {
          if_block0.c();
          if_block0.m(header, null);
        }
      }
      if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx2, dirty)) && if_block1) {
        if_block1.p(ctx2, dirty);
      } else {
        if_block1.d(1);
        if_block1 = current_block_type_1(ctx2);
        if (if_block1) {
          if_block1.c();
          if_block1.m(div0, null);
        }
      }
    },
    i: noop,
    o: noop,
    d(detaching) {
      if (detaching) {
        detach(div1);
      }
      if_block0.d();
      if_block1.d();
      ctx[22](null);
      mounted = false;
      dispose();
    }
  };
}
var CARD_HEIGHT = 220;
var OVERSCAN = 5;
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}
function instance($$self, $$props, $$invalidate) {
  let visibleCount;
  let startIndex;
  let endIndex;
  let topPadding;
  let bottomPadding;
  let visibleCards;
  let { cards = [] } = $$props;
  let { folderPath = "" } = $$props;
  let { selectedPath = null } = $$props;
  let { loading = false } = $$props;
  let { generation = 0 } = $$props;
  const dispatch = createEventDispatcher();
  let viewportEl = null;
  let viewportHeight = 0;
  let scrollTop = 0;
  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;
  function onScroll() {
    if (!viewportEl) {
      return;
    }
    $$invalidate(13, scrollTop = viewportEl.scrollTop);
    $$invalidate(12, viewportHeight = viewportEl.clientHeight);
  }
  function openNote(path) {
    dispatch("open-note", { path });
  }
  function onCardKeydown(event, path) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(path);
    }
  }
  const click_handler = (card) => openNote(card.path);
  const keydown_handler = (card, event) => onCardKeydown(event, card.path);
  function div0_binding($$value) {
    binding_callbacks[$$value ? "unshift" : "push"](() => {
      viewportEl = $$value;
      $$invalidate(4, viewportEl);
    });
  }
  $$self.$$set = ($$props2) => {
    if ("cards" in $$props2) $$invalidate(0, cards = $$props2.cards);
    if ("folderPath" in $$props2) $$invalidate(1, folderPath = $$props2.folderPath);
    if ("selectedPath" in $$props2) $$invalidate(2, selectedPath = $$props2.selectedPath);
    if ("loading" in $$props2) $$invalidate(3, loading = $$props2.loading);
    if ("generation" in $$props2) $$invalidate(11, generation = $$props2.generation);
  };
  $$self.$$.update = () => {
    if ($$self.$$.dirty & /*viewportHeight*/
    4096) {
      $: $$invalidate(19, visibleCount = Math.max(1, Math.ceil(viewportHeight / CARD_HEIGHT) + OVERSCAN * 2));
    }
    if ($$self.$$.dirty & /*scrollTop*/
    8192) {
      $: $$invalidate(18, startIndex = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - OVERSCAN));
    }
    if ($$self.$$.dirty & /*cards, startIndex, visibleCount*/
    786433) {
      $: $$invalidate(17, endIndex = Math.min(cards.length, startIndex + visibleCount));
    }
    if ($$self.$$.dirty & /*startIndex*/
    262144) {
      $: $$invalidate(7, topPadding = startIndex * CARD_HEIGHT);
    }
    if ($$self.$$.dirty & /*cards, endIndex*/
    131073) {
      $: $$invalidate(6, bottomPadding = Math.max(0, (cards.length - endIndex) * CARD_HEIGHT));
    }
    if ($$self.$$.dirty & /*cards, startIndex, endIndex*/
    393217) {
      $: $$invalidate(5, visibleCards = cards.slice(startIndex, endIndex));
    }
    if ($$self.$$.dirty & /*generation, lastHydrateGeneration*/
    67584) {
      $: if (generation !== lastHydrateGeneration) {
        $$invalidate(16, lastHydrateGeneration = generation);
        $$invalidate(14, lastRangeStart = -1);
        $$invalidate(15, lastRangeEnd = -1);
      }
    }
    if ($$self.$$.dirty & /*startIndex, lastRangeStart, endIndex, lastRangeEnd*/
    442368) {
      $: {
        if (startIndex !== lastRangeStart || endIndex !== lastRangeEnd) {
          $$invalidate(14, lastRangeStart = startIndex);
          $$invalidate(15, lastRangeEnd = endIndex);
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
    viewportEl,
    visibleCards,
    bottomPadding,
    topPadding,
    onScroll,
    openNote,
    onCardKeydown,
    generation,
    viewportHeight,
    scrollTop,
    lastRangeStart,
    lastRangeEnd,
    lastHydrateGeneration,
    endIndex,
    startIndex,
    visibleCount,
    click_handler,
    keydown_handler,
    div0_binding
  ];
}
var FolderCardPanel = class extends SvelteComponent {
  constructor(options) {
    super();
    init(this, options, instance, create_fragment, safe_not_equal, {
      cards: 0,
      folderPath: 1,
      selectedPath: 2,
      loading: 3,
      generation: 11
    });
  }
};
var FolderCardPanel_default = FolderCardPanel;

// src/view/markdown-utils.ts
var import_obsidian = require("obsidian");
var FRONTMATTER_IMAGE_KEYS = ["cover", "image", "banner", "thumbnail", "hero", "cardImage"];
function stripMarkdownToText(markdown, maxLength = 260) {
  const text2 = markdown.replace(/^---[\s\S]*?---\s*/m, "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/!\[[^\]]*]\([^)]+\)/g, " ").replace(/!\[\[[^\]]+]]/g, " ").replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_, link, alias) => alias != null ? alias : link).replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").replace(/[>*_~]/g, " ").replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
  if (text2.length <= maxLength) {
    return text2;
  }
  return `${text2.slice(0, maxLength).trimEnd()}...`;
}
function pickFrontmatterImage(frontmatter) {
  if (!frontmatter) {
    return null;
  }
  for (const key of FRONTMATTER_IMAGE_KEYS) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim().length > 0);
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }
  return null;
}
function extractFirstInlineImage(markdown) {
  var _a;
  const wiki = markdown.match(/!\[\[([^\]]+)]]/);
  if (wiki == null ? void 0 : wiki[1]) {
    return wiki[1];
  }
  const md = markdown.match(/!\[[^\]]*]\(([^)]+)\)/);
  if (md == null ? void 0 : md[1]) {
    return md[1];
  }
  const html = markdown.match(/<img\s[^>]*src=["']([^"']+)["']/i);
  return (_a = html == null ? void 0 : html[1]) != null ? _a : null;
}
function resolveImageSource(app, source, contextFile) {
  const cleaned = cleanupImageTarget(source);
  if (!cleaned) {
    return null;
  }
  if (/^(https?:\/\/|data:)/i.test(cleaned)) {
    return cleaned;
  }
  const local = app.metadataCache.getFirstLinkpathDest(cleaned, contextFile.path);
  if (local instanceof import_obsidian.TFile) {
    return app.vault.getResourcePath(local);
  }
  const absolutePath = cleaned.replace(/^\//, "");
  const byPath = app.vault.getAbstractFileByPath(absolutePath);
  if (byPath instanceof import_obsidian.TFile) {
    return app.vault.getResourcePath(byPath);
  }
  return null;
}
function cleanupImageTarget(input) {
  let value = input.trim().replace(/^["']|["']$/g, "");
  const titleDivider = value.search(/\s+"[^"]*"$/);
  if (titleDivider > -1) {
    value = value.slice(0, titleDivider);
  }
  const pipeIndex = value.indexOf("|");
  if (pipeIndex > -1) {
    value = value.slice(0, pipeIndex);
  }
  const hashIndex = value.indexOf("#");
  if (hashIndex > -1) {
    value = value.slice(0, hashIndex);
  }
  return decodeURIComponentSafe(value).trim();
}
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

// src/view/FolderCardView.ts
var FOLDER_CARD_VIEW = "folder-card-view";
var FolderCardView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.component = null;
    this.hostEl = null;
    this.folderPath = null;
    this.cards = [];
    this.selectedPath = null;
    this.loading = false;
    this.generation = 0;
    this.pendingHydration = /* @__PURE__ */ new Set();
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
    (_a = this.component) == null ? void 0 : _a.$destroy();
    this.component = null;
    this.hostEl = null;
  }
  async setFolder(folder) {
    this.folderPath = folder.path;
    this.loading = true;
    this.cards = [];
    this.generation += 1;
    this.pendingHydration.clear();
    this.pushState();
    const buildGeneration = this.generation;
    const files = this.collectMarkdownFiles(folder);
    const records = files.map((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatterCover = pickFrontmatterImage(cache == null ? void 0 : cache.frontmatter);
      return {
        file,
        path: file.path,
        title: file.basename,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        cover: frontmatterCover ? resolveImageSource(this.app, frontmatterCover, file) : null,
        excerpt: "",
        hydrated: false
      };
    });
    if (buildGeneration !== this.generation) {
      return;
    }
    records.sort((a, b) => b.mtime - a.mtime);
    this.cards = records;
    this.loading = false;
    this.pushState();
  }
  setSelectedFile(path) {
    this.selectedPath = path;
    this.pushState();
  }
  async refresh() {
    if (!this.folderPath) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (folder instanceof import_obsidian2.TFolder) {
      await this.setFolder(folder);
    }
  }
  collectMarkdownFiles(root) {
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
      card.excerpt = stripMarkdownToText(markdown, 240);
      if (!card.cover) {
        const firstInlineImage = extractFirstInlineImage(markdown);
        if (firstInlineImage) {
          card.cover = resolveImageSource(this.app, firstInlineImage, card.file);
        }
      }
      card.hydrated = true;
    } catch (e) {
      card.excerpt = "";
      card.hydrated = true;
    }
  }
  pushState() {
    var _a, _b;
    (_b = this.component) == null ? void 0 : _b.$set({
      cards: [...this.cards],
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
    this.debouncedRefresh = (0, import_obsidian3.debounce)(
      () => {
        void this.refreshFolderCards();
      },
      250,
      false
    );
  }
  async onload() {
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
    this.selectedFolderPath = folder.path;
    await this.activateView();
    this.withFolderViews((view) => {
      void view.setFolder(folder);
    });
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
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof import_obsidian3.TFolder && this.selectedFolderPath === oldPath) {
          this.selectedFolderPath = file.path;
        }
        if (this.shouldRefreshForPath(file.path) || this.shouldRefreshForPath(oldPath)) {
          this.debouncedRefresh();
        }
      })
    );
  }
  shouldRefreshForPath(path) {
    if (!this.selectedFolderPath) {
      return false;
    }
    return path === this.selectedFolderPath || path.startsWith(`${this.selectedFolderPath}/`);
  }
  async refreshFolderCards() {
    if (!this.selectedFolderPath) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(this.selectedFolderPath);
    if (!(folder instanceof import_obsidian3.TFolder)) {
      return;
    }
    this.withFolderViews((view) => {
      void view.refresh();
    });
  }
};
