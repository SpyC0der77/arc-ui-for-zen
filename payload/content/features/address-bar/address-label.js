/* Retain the native address text and icon while Zen moves its URL bar into the command popup. */
var ArcAddressLabel = {
  install(window, dependencies = {}) {
    const { document, gURLBar, ResizeObserver, MutationObserver } = window;
    const { el } = dependencies;
    const getComputedStyle = window.getComputedStyle.bind(window);
    // The native URL bar moves into the popover. Keep its last sidebar text behind.
    const addressContainer = document.getElementById("urlbar-container");
    const addressLabel = el("span", {
      id: "arc-sidebar-address-label",
      "aria-hidden": "true",
    });
    const addressIcon = el("span", { class: "arc-sidebar-address-icon" });
    const addressText = el("span", { class: "arc-sidebar-address-text" });
    addressLabel.append(addressIcon, addressText);
    addressContainer.append(addressLabel);
    let addressAnchor = null;
    function positionAddressLabel() {
      if (!addressAnchor) return;
      const current = addressContainer.getBoundingClientRect();
      addressLabel.style.left = `${addressAnchor.left - current.left}px`;
      addressLabel.style.top = `${addressAnchor.top - current.top}px`;
      addressLabel.style.right = "auto";
      addressLabel.style.bottom = "auto";
      addressLabel.style.width = `${addressAnchor.width}px`;
      addressLabel.style.height = `${addressAnchor.height}px`;
    }
    function rememberAddress() {
      if (
        gURLBar.hasAttribute("zen-floating-urlbar") ||
        gURLBar.hasAttribute("breakout-extend")
      ) {
        positionAddressLabel();
        return;
      }
      const input = gURLBar.inputField;
      addressText.textContent =
        input.value || input.placeholder || "Search or enter address";
      const textStyle = getComputedStyle(
        input,
        input.value ? null : "::placeholder",
      );
      const inputStyle = getComputedStyle(input);
      const fieldRect = input.getBoundingClientRect(),
        containerRect = addressContainer.getBoundingClientRect();
      const background = gURLBar.querySelector(".urlbar-background");
      const surfaceRect = background?.getBoundingClientRect() || containerRect;
      addressAnchor = {
        left: surfaceRect.left,
        top: surfaceRect.top,
        width: surfaceRect.width,
        height: surfaceRect.height,
      };
      positionAddressLabel();
      // Native input text lives inside an anonymous editor, whose origin can differ
      // from the input border by a fractional pixel. Use that actual text origin.
      const editorRect = input.editor?.rootElement?.getBoundingClientRect();
      const textOrigin = editorRect?.width
        ? editorRect.left
        : fieldRect.left +
          (parseFloat(inputStyle.paddingLeft) || 0) +
          (parseFloat(inputStyle.borderLeftWidth) || 0);
      const textLeft =
        textOrigin -
        addressAnchor.left -
        addressContainer.clientLeft +
        (parseFloat(inputStyle.textIndent) || 0);
      addressText.style.left = `${textLeft}px`;
      for (const property of [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStretch",
        "fontStyle",
        "letterSpacing",
        "wordSpacing",
        "direction",
      ]) {
        addressText.style[property] = inputStyle[property];
      }
      addressText.style.right = `${Math.max(0, surfaceRect.right - fieldRect.right)}px`;
      addressText.style.color = textStyle.color;
      addressText.style.opacity = textStyle.opacity;
      if (background)
        addressLabel.style.backgroundColor =
          getComputedStyle(background).backgroundColor;
      // Use the native visible identity/search icon, including its context paint.
      const nativeIcon = [
        ...gURLBar.querySelectorAll("image, img, svg, [class*='icon']"),
      ].find((node) => {
        const s = getComputedStyle(node),
          r = node.getBoundingClientRect(),
          field = input.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.width <= 24 &&
          r.height > 0 &&
          r.height <= 24 &&
          r.right <= field.left + 2 &&
          s.visibility === "visible" &&
          Number(s.opacity) > 0
        );
      });
      addressIcon.hidden = !nativeIcon;
      const iconStyle = nativeIcon && getComputedStyle(nativeIcon);
      const iconRect = nativeIcon?.getBoundingClientRect();
      addressIcon.style.left = `${iconRect ? iconRect.left - addressAnchor.left - addressContainer.clientLeft : Math.max(0, textLeft - 24)}px`;
      addressIcon.style.width = `${iconRect?.width || 16}px`;
      addressIcon.style.height = `${iconRect?.height || 16}px`;
      addressIcon.style.backgroundImage =
        (iconStyle?.listStyleImage !== "none" && iconStyle?.listStyleImage) ||
        (iconStyle?.backgroundImage !== "none" && iconStyle?.backgroundImage) ||
        'url("chrome://global/skin/icons/search-glass.svg")';
      addressIcon.style.color = iconStyle?.color || textStyle.color;
      addressIcon.style.fill = iconStyle?.fill || "currentColor";
      addressIcon.style.fillOpacity = iconStyle?.fillOpacity || "1";
    }
    rememberAddress();
    const addressResizeObserver = new ResizeObserver(rememberAddress);
    addressResizeObserver.observe(addressContainer);
    addressContainer.addEventListener("pointerdown", rememberAddress, true);
    addressContainer.addEventListener("pointerenter", rememberAddress, true);
    let addressFrame = 0;
    const addressObserver = new MutationObserver(() => {
      if (addressFrame) return;
      addressFrame = window.requestAnimationFrame(() => {
        addressFrame = 0;
        rememberAddress();
      });
    });
    addressObserver.observe(gURLBar, {
      attributes: true,
      attributeFilter: ["zen-floating-urlbar", "open", "breakout-extend"],
    });

    return {
      rememberAddress,
      destroy() {
        addressObserver.disconnect();
        addressResizeObserver.disconnect();
        if (addressFrame) window.cancelAnimationFrame(addressFrame);
        addressContainer.removeEventListener(
          "pointerdown",
          rememberAddress,
          true,
        );
        addressContainer.removeEventListener(
          "pointerenter",
          rememberAddress,
          true,
        );
        addressLabel.remove();
      },
    };
  },
};
