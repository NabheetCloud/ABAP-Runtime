@EndUserText.label : 'Exchange rates'
define table tcurr {
  key mandt : abap.clnt not null;
  key kurst : abap.char(4) not null;
  key fcurr : abap.cuky not null;
  key tcurr : abap.cuky not null;
  key gdatu : abap.dats not null;
  ukurs     : abap.dec(9,5);
  ffact     : abap.dec(9,0);
  tfact     : abap.dec(9,0);
}
