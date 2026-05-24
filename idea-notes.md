# BikeFit

## Główny problem

Profesjonalny bike fitting to bardzo droga usługa świadczona w serwisach rowerowych. Dla amatora taka kosztowna analiza nie zawsze jest uzasadniona — szczególnie gdy rowerzysta chce jedynie wstępnie ocenić swoją pozycję i otrzymać ogólne wskazówki dotyczące regulacji (np. siodełko wyżej/niżej, do przodu/do tyłu). Rozwiązanie online, umożliwiające wgranie krótkiego nagrania wideo i uzyskanie analizy sylwetki wraz z propozycjami korekt, byłoby doskonałym punktem wyjścia do samodzielnego bike fittingu.

## Minimalny zestaw funkcjonalności

* Wgrywanie krótkich nagrań wideo z jazdy na rowerze (ujęcie z boku, maks. 10 s)
* Analiza wideo wspierana przez AI
* Integracja z gotowym narzędziem do analizy klatek (precyzyjne wykrywanie keypointów)
* Obliczanie podstawowych kątów istotnych dla bike fittingu:
  * korba na godzinie 6 (Bottom Dead Center)
  * korba na godzinie 3 (Power Phase)
  * korba na godzinie 12 (Top Dead Center)
* Interpretacja wyników i zalecenia fittingowe wspierane przez AI
* Prosty system kont użytkowników do przechowywania sesji bike-fittingowych
* Przeglądanie historii sesji bike-fittingowych

## Co nie wchodzi w zakres MVP

* Własny system do analizy wideo
* Własne narzędzie do analizy klatek i wykrywania keypointów
* Własne narzędzie do obliczania kątów
* Import wielu formatów wideo
* Aplikacja mobilna (na początku wyłącznie web)
* Obsługa wielu typów rowerów (na początku tylko bike fitting pod rowery gravelowe)

## Kryterium sukcesu

* Analiza sylwetki i kątów rowerzysty mieści się w błędzie ±10°
* Zalecenia bike-fittingowe mieszczą się w przyjętych zakresach referencyjnych
