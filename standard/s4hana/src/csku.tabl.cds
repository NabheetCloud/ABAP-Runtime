@EndUserText.label : 'Cost element text (legacy/classic; cost elements are G/L accounts in S/4)'
define table csku {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key ktopl : abap.char(4) not null;
  key kstar : abap.char(20) not null;
  ktext     : abap.char(40);
  ltext     : abap.char(40);
}
