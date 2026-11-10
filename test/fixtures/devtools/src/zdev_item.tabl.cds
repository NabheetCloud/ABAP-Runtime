@EndUserText.label : 'Items'
define table zdev_item {
  key client : abap.clnt not null;
  key id     : abap.int4 not null;
  name       : abap.char(20);
}
