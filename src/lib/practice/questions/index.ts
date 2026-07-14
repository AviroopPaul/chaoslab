// QUESTIONS: all practice questions, ordered easy -> hard, per SPEC-PRACTICE.md §5.

import type { Question } from '../types';
import { urlShortener } from './url-shortener';
import { rateLimiter } from './rate-limiter';
import { newsFeed } from './news-feed';
import { autocomplete } from './autocomplete';
import { notificationSystem } from './notification-system';
import { fileStorage } from './file-storage';
import { chatSystem } from './chat-system';
import { videoStreaming } from './video-streaming';
import { flashSale } from './flash-sale';
import { webCrawler } from './web-crawler';
import { rideHailing } from './ride-hailing';
import { paymentSystem } from './payment-system';

export const QUESTIONS: Question[] = [
  urlShortener,
  rateLimiter,
  newsFeed,
  autocomplete,
  notificationSystem,
  fileStorage,
  chatSystem,
  videoStreaming,
  flashSale,
  webCrawler,
  rideHailing,
  paymentSystem,
];
