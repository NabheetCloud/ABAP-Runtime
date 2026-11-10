@EndUserText.label : 'Terms of payment texts'
define table tvzbt {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key zterm : abap.char(4) not null;
  vtext     : abap.char(30);
}
