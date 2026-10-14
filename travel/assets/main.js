/*
 * Wander & Linger — 共享交互
 * 导航显隐、滚动进入动效、横向滚动、评价轮播、表单反馈。无依赖。
 */
(function () {
  "use strict";

  var doc = document.documentElement;
  doc.classList.add("js");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 导航：向下隐藏、向上出现，离开首屏后切换为毛玻璃 ---------- */
  var nav = document.querySelector(".nav");
  if (nav) {
    var lastY = window.scrollY;
    var ticking = false;
    var solidAt = function () { return Math.max(80, window.innerHeight * 0.6); };

    var updateNav = function () {
      var y = window.scrollY;
      var delta = y - lastY;
      nav.classList.toggle("is-solid", y > solidAt());
      if (Math.abs(delta) > 6) {
        nav.classList.toggle("is-hidden", delta > 0 && y > 160);
        lastY = y;
      }
      ticking = false;
    };

    window.addEventListener("scroll", function () {
      if (!ticking) { window.requestAnimationFrame(updateNav); ticking = true; }
    }, { passive: true });
    updateNav();
  }

  /* ---------- 移动端菜单 ---------- */
  var drawer = document.querySelector(".drawer");
  var toggle = document.querySelector(".nav__toggle");
  if (drawer && toggle) {
    var setDrawer = function (open) {
      drawer.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };
    toggle.addEventListener("click", function () { setDrawer(true); });
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("a, .drawer__close")) setDrawer(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawer(false);
    });
  }

  /* ---------- 滚动进入动效 ---------- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-in"); });
  }

  /* ---------- 横向滚动：按钮、拖拽、进度条 ---------- */
  document.querySelectorAll("[data-track]").forEach(function (track) {
    var root = track.closest("section");
    var prev = root.querySelector("[data-prev]");
    var next = root.querySelector("[data-next]");
    var bar = root.querySelector(".progress span");

    var step = function () {
      var item = track.firstElementChild;
      if (!item) return track.clientWidth;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return item.getBoundingClientRect().width + gap;
    };

    var sync = function () {
      var max = track.scrollWidth - track.clientWidth;
      var ratio = max > 0 ? track.scrollLeft / max : 1;
      if (bar) {
        var visible = track.clientWidth / track.scrollWidth;
        bar.style.transform = "scaleX(" + Math.min(1, visible + ratio * (1 - visible)) + ")";
      }
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max - 2;
    };

    if (prev) prev.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: "smooth" }); });
    if (next) next.addEventListener("click", function () { track.scrollBy({ left: step(), behavior: "smooth" }); });
    track.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();

    // 仅鼠标拖拽；触屏使用原生滚动
    var startX = 0, startLeft = 0, dragging = false, moved = false;
    track.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      dragging = true; moved = false;
      startX = e.clientX; startLeft = track.scrollLeft;
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 4) { moved = true; track.classList.add("is-dragging"); }
      if (moved) track.scrollLeft = startLeft - dx;
    });
    window.addEventListener("pointerup", function () {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("is-dragging");
    });
    track.addEventListener("click", function (e) {
      if (moved) { e.preventDefault(); moved = false; }
    }, true);
  });

  /* ---------- 用户评价：一次一条，自动淡入淡出 ---------- */
  document.querySelectorAll("[data-voices]").forEach(function (root) {
    var items = Array.prototype.slice.call(root.querySelectorAll(".voice"));
    var dotsWrap = root.querySelector(".voices__dots");
    if (!items.length) return;
    var current = 0;
    var timer = null;
    var interval = 6500;

    var dots = items.map(function (_, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "第 " + (i + 1) + " 条评价");
      b.addEventListener("click", function () { show(i); restart(); });
      dotsWrap.appendChild(b);
      return b;
    });

    function show(i) {
      items[current].classList.remove("is-active");
      dots[current].removeAttribute("aria-current");
      current = (i + items.length) % items.length;
      items[current].classList.add("is-active");
      dots[current].setAttribute("aria-current", "true");
    }
    function restart() {
      clearInterval(timer);
      if (!reduceMotion) timer = setInterval(function () { show(current + 1); }, interval);
    }

    items[0].classList.add("is-active");
    dots[0].setAttribute("aria-current", "true");
    root.addEventListener("mouseenter", function () { clearInterval(timer); });
    root.addEventListener("mouseleave", restart);
    restart();
  });

  /* ---------- 表单：前端演示反馈 ---------- */
  document.querySelectorAll("[data-letter]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var name = (form.querySelector("[name=name]") || {}).value || "";
      var box = form.closest(".letter");
      var thanks = box.querySelector(".letter__thanks");
      if (thanks && name) thanks.querySelector("[data-name]").textContent = name;
      box.classList.add("is-sent");
    });
  });

  document.querySelectorAll("[data-subscribe]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var msg = form.parentElement.querySelector(".subscribe-msg");
      form.reset();
      if (msg) msg.classList.add("is-shown");
    });
  });

  /* ---------- 页脚年份 ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
