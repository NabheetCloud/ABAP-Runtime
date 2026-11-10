@EndUserText.label : 'Factory calendar'
define table tfacd {
  key mandt : abap.clnt not null;
  key ident : abap.char(2) not null;
  vjahr     : abap.char(20);
  bjahr     : abap.char(20);
  ltext     : abap.char(40);
}
