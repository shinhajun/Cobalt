function fromAutocomplete(attr) {
  if (!attr) return '';
  const token = String(attr).toLowerCase().trim();
  const map = new Map([
    ['name', 'name'],
    ['given-name', 'name'],
    ['family-name', 'name'],
    ['email', 'email'],
    ['tel', 'phone'],
    ['organization', 'company'],
    ['street-address', 'address-line1'],
    ['address-line1', 'address-line1'],
    ['address-line2', 'address-line2'],
    ['address-level2', 'city'],
    ['address-level1', 'state'],
    ['postal-code', 'postal'],
    ['country', 'country'],
  ]);
  return map.get(token) || '';
}

function containsAny(s, arr) {
  const t = (s || '').toLowerCase();
  return arr.some(k => t.includes(k));
}

function fromTokens({ name, id, placeholder, type }) {
  const hay = `${name || ''} ${id || ''} ${placeholder || ''}`.toLowerCase();
  if (containsAny(hay, ['email', 'e-mail', '메일'])) return 'email';
  if (containsAny(hay, ['tel', 'phone', '휴대', '전화'])) return 'phone';
  if (containsAny(hay, ['name', 'fullname', '성명', '이름'])) return 'name';
  if (containsAny(hay, ['company', 'org', '회사'])) return 'company';
  if (containsAny(hay, ['address', 'addr', '주소'])) return 'address-line1';
  if (containsAny(hay, ['address2', 'addr2', '상세'])) return 'address-line2';
  if (containsAny(hay, ['city', '구', '군', '시'])) return 'city';
  if (containsAny(hay, ['state', '도'])) return 'state';
  if (containsAny(hay, ['zip', 'post', '우편', '우편번호'])) return 'postal';
  if (containsAny(hay, ['country', '국가'])) return 'country';
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  return '';
}

function classifyField(hints) {
  const viaAuto = fromAutocomplete(hints.autocomplete);
  if (viaAuto) return viaAuto;
  const viaTokens = fromTokens(hints);
  if (viaTokens) return viaTokens;
  return '';
}

module.exports = { classifyField };

