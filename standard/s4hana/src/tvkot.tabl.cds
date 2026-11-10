@EndUserText.label : 'Sales organization texts'
define table tvkot {
  key mandt : abap.clnt not null;
  key spras : abap.lang not null;
  key vkorg : abap.char(4) not null;
  vtext     : abap.char(20);
}
