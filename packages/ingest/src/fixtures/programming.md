## Closures in JavaScript

A closure is a function together with the variables it captured from the scope where it was created. The function keeps access to those variables even after the outer function has returned.

```js
function counter() {
  let count = 0;

  return () => ++count;
}
```

Each call to `counter()` creates a new `count`, so two counters never share state. This is how modules hid private variables before JavaScript had classes and private fields.

## Short

Too short to ask about.
