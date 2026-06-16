const guardedButton = document.querySelector('[data-testid="guarded-submit"]');
guardedButton?.addEventListener('click', () => {
  document.querySelector('#guarded-status').textContent = 'Guarded order submitted';
});

const dynamicRoot = document.querySelector('#dynamic-root');
function renderDynamicButton(label = 'Submit dynamic order') {
  dynamicRoot.replaceChildren();
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'dynamic-submit';
  button.textContent = label;
  button.addEventListener('click', () => {
    document.querySelector('#dynamic-status').textContent = 'Dynamic order submitted';
  });
  dynamicRoot.append(button);
}
renderDynamicButton();
window.addEventListener('auroraflow:rerender-dynamic', () => {
  renderDynamicButton('Submit dynamic order after rerender');
});

class ShadowCheckout extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'shadow-submit';
    button.textContent = 'Submit shadow order';
    button.addEventListener('click', () => {
      document.querySelector('#shadow-status').textContent = 'Shadow order submitted';
    });
    root.append(button);
  }
}
customElements.define('shadow-checkout', ShadowCheckout);

window.addEventListener('message', (event) => {
  if (
    event.origin === window.location.origin &&
    event.data?.type === 'auroraflow:iframe-submitted'
  ) {
    document.querySelector('#iframe-status').textContent = 'Iframe order submitted';
  }
});
