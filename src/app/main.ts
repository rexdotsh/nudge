import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './lib/app.svelte';
import './styles.css';

const target = document.getElementById('app');
if (!target) throw new Error('missing #app');

const touch = matchMedia('(pointer: coarse)').matches;
const skin = app.platform === 'windows' || (!touch && app.platform !== 'ios') ? 'windows' : 'ios';
document.documentElement.dataset.platform = skin;

if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
mount(App, { target, props: { skin } });
void app.start();
