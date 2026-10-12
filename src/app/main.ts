import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './lib/app.svelte';
import { stayCurrent } from './lib/update.svelte';
import './styles.css';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app');

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
  stayCurrent(navigator.serviceWorker);
}
mount(App, { target });
void app.start();
