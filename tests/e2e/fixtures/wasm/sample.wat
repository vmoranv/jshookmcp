; WebAssembly text format - minimal module with add function
(module
  (func $add (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add)
  (export "add" (func $add))
  (func $main (result i32)
    i32.const 0)
  (export "main" (func $main)))
